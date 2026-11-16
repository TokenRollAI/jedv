import type {
	MailTimelineResult,
	TeamStatusResult,
} from "@jedv/host-service/teamwork";
import { createRelaySocket } from "@jedv/workspace-client/relay-socket";
import {
	skipToken,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { LocalClient } from "../../local-client";

export type TeamSnapshot = TeamStatusResult;
export type TeamMember = TeamSnapshot["members"][number];
export type Team = TeamSnapshot["team"];
export type MailItem = MailTimelineResult[number];
export type WorkspaceTeam = { id: string; name: string; count: number };
export const teamworkKey = (hostUrl: string) =>
	["jedv", hostUrl, "teamwork"] as const;
export const teamStatusKey = (hostUrl: string, id: string) => [
	...teamworkKey(hostUrl),
	"status",
	id,
];

export function useTeamwork(
	client: LocalClient | null,
	hostUrl: string | null,
	token: string | null,
) {
	const cache = useQueryClient();
	const credentials = useRef(token);
	credentials.current = token;
	const capabilities = useQuery({
		queryKey: [...teamworkKey(hostUrl ?? "disconnected"), "capabilities"],
		queryFn: client ? () => client.team.capabilities.query() : skipToken,
		enabled: !!client && !!hostUrl,
		retry: false,
		refetchInterval: 30_000,
		gcTime: 30_000,
	});
	const supported =
		capabilities.data?.protocolVersion === 1 && !capabilities.isError;
	const list = useQuery({
		queryKey: [...teamworkKey(hostUrl ?? "disconnected"), "list"],
		queryFn: client
			? () => client.team.list.query({ status: "all" })
			: skipToken,
		enabled: !!client && supported,
		retry: false,
		refetchInterval: 15_000,
		gcTime: 30_000,
	});
	const active =
		list.data?.filter(
			(team) => team.status === "active" || team.status === "paused",
		) ?? [];
	const snapshots = useQueries({
		queries: active.map((team) => ({
			queryKey: teamStatusKey(hostUrl ?? "disconnected", team.id),
			queryFn: client
				? () => client.team.status.query({ teamId: team.id })
				: skipToken,
			enabled: supported,
			retry: false,
			refetchInterval: 10_000,
			gcTime: 30_000,
		})),
	});
	const workspaceTeams = new Map<string, WorkspaceTeam[]>();
	for (const snapshot of snapshots) {
		if (!supported || !snapshot.data || snapshot.isError) continue;
		const { team, members } = snapshot.data;
		if (team.status !== "active" && team.status !== "paused") continue;
		const live = members.filter(
			(member) =>
				member.status === "active" ||
				member.status === "spawning" ||
				member.status === "reconcile_required",
		);
		for (const workspaceId of new Set(
			live
				.map((member) => member.workspaceId)
				.filter((id): id is string => !!id),
		)) {
			const rows = workspaceTeams.get(workspaceId) ?? [];
			rows.push({ id: team.id, name: team.name, count: live.length });
			workspaceTeams.set(workspaceId, rows);
		}
	}
	useEffect(() => {
		if (!hostUrl || !supported) return;
		// The shared event bus has no Teamwork listeners yet; reuse its authenticated transport.
		const socket = createRelaySocket({
			buildUrl: () => `${hostUrl.replace(/\/$/, "")}/events`,
			getToken: () => credentials.current,
			maxEnqueuedMessages: 0,
		});
		const refresh = () =>
			void cache.invalidateQueries({ queryKey: teamworkKey(hostUrl) });
		socket.addEventListener("open", refresh);
		socket.addEventListener("message", (event) => {
			try {
				const message = JSON.parse(String(event.data));
				if (
					[
						"team:changed",
						"mail:changed",
						"agent:lifecycle",
						"agent:bindings-changed",
						"terminal:lifecycle",
					].includes(message.type)
				)
					refresh();
			} catch {
				/* Ignore malformed frames; polling reconciles missed events. */
			}
		});
		return () => socket.close();
	}, [hostUrl, supported, cache]);
	return {
		deleteTeam: async (teamId: string) => {
			if (
				!client ||
				!hostUrl ||
				!supported ||
				list.isError ||
				!capabilities.data?.features?.delete
			)
				throw new Error("Teamwork is unavailable");
			await client.team.delete.mutate({ teamId });
			await cache.invalidateQueries({ queryKey: teamworkKey(hostUrl) });
		},
		capabilities,
		supported,
		list,
		workspaceTeams,
		activeSnapshots: snapshots.flatMap((query) =>
			query.data ? [query.data] : [],
		),
		membershipError: snapshots.some((query) => query.isError),
		membershipReady:
			supported &&
			list.isSuccess &&
			!list.isError &&
			snapshots.every((query) => query.isSuccess && !query.isError),
	};
}
