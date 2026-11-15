import type {
	AttentionSourceInput,
	AttentionSourceTarget,
} from "@jedv/shared/butler-attention";
import { and, eq, or } from "drizzle-orm";
import {
	mailDeliveries,
	mailEvents,
	projects,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import type { HostServiceContext } from "../types";
import { attentionSource } from "./source";

export type LiveAttentionTerminal = { terminalId: string; workspaceId: string };
export interface AttentionLocatorOptions {
	listLiveTerminals?: () => Promise<LiveAttentionTerminal[]>;
}
// Queries process/session liveness only. Never attaches to, restores or creates a PTY.
export function createAttentionSourceLocator(
	ctx: HostServiceContext,
	options: AttentionLocatorOptions = {},
) {
	return async (
		inputs: AttentionSourceInput[],
	): Promise<AttentionSourceTarget[]> => {
		const enriched = inputs.map((input) => {
			const source = attentionSource(input);
			if (source.mailDeliveryId) {
				const mail = ctx.db
					.select({
						recipientMemberId: mailDeliveries.recipientMemberId,
						teamId: mailEvents.teamId,
					})
					.from(mailDeliveries)
					.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
					.where(eq(mailDeliveries.id, source.mailDeliveryId))
					.get();
				if (mail) {
					source.memberId ??= mail.recipientMemberId;
					source.teamId ??= mail.teamId;
				}
			}
			const member = source.memberId
				? ctx.db
						.select()
						.from(teamMembers)
						.where(
							source.teamId
								? and(
										eq(teamMembers.teamId, source.teamId),
										or(
											eq(teamMembers.id, source.memberId),
											eq(teamMembers.name, source.memberId),
										),
									)
								: eq(teamMembers.id, source.memberId),
						)
						.get()
				: source.teamId
					? ctx.db
							.select()
							.from(teamMembers)
							.where(
								and(
									eq(teamMembers.teamId, source.teamId),
									eq(teamMembers.role, "leader"),
								),
							)
							.get()
					: undefined;
			if (member) {
				source.memberId = member.id;
				source.teamId ??= member.teamId;
				source.workspaceId ??= member.workspaceId;
				source.terminalId ??= member.terminalId;
			}
			const terminal = source.terminalId
				? ctx.db
						.select()
						.from(terminalSessions)
						.where(eq(terminalSessions.id, source.terminalId))
						.get()
				: undefined;
			source.workspaceId ??= terminal?.originWorkspaceId ?? null;
			const workspace = source.workspaceId
				? ctx.db
						.select()
						.from(workspaces)
						.where(eq(workspaces.id, source.workspaceId))
						.get()
				: undefined;
			source.projectId ??= workspace?.projectId ?? null;
			const project = workspace?.projectId
				? ctx.db
						.select()
						.from(projects)
						.where(eq(projects.id, workspace.projectId))
						.get()
				: undefined;
			const workspaceLive =
				!!workspace &&
				workspace.archivedAt === null &&
				(!workspace.projectId || (!!project && project.deletedAt === null));
			const team = source.teamId
				? ctx.db.select().from(teams).where(eq(teams.id, source.teamId)).get()
				: undefined;
			source.fallback = workspaceLive
				? "workspace"
				: team
					? "team"
					: source.kind === "automation_run"
						? "automations"
						: source.kind === "memory"
							? "memory"
							: null;
			return {
				source,
				canFocus:
					workspaceLive &&
					!!terminal &&
					terminal.status === "active" &&
					terminal.endedAt === null &&
					terminal.disposeRequestedAt === null &&
					terminal.originWorkspaceId === source.workspaceId,
			};
		});
		let live: LiveAttentionTerminal[] = [];
		if (enriched.some((item) => item.canFocus))
			try {
				live = await (options.listLiveTerminals
					? options.listLiveTerminals()
					: import("../terminal/terminal").then((module) =>
							module.listLiveTerminalSessions(ctx.db),
						));
			} catch {
				/* A failed liveness probe must fall back, never resurrect a terminal. */
			}
		const liveById = new Map(
			live.map((item) => [item.terminalId, item.workspaceId]),
		);
		// Re-check durable disposal/archive after awaiting the process probe.
		return enriched.map(({ source, canFocus }) => {
			const workspace = source.workspaceId
				? ctx.db
						.select()
						.from(workspaces)
						.where(eq(workspaces.id, source.workspaceId))
						.get()
				: undefined;
			const project = workspace?.projectId
				? ctx.db
						.select()
						.from(projects)
						.where(eq(projects.id, workspace.projectId))
						.get()
				: undefined;
			const workspaceLive =
				!!workspace &&
				workspace.archivedAt === null &&
				(!workspace.projectId || (!!project && project.deletedAt === null));
			const team = source.teamId
				? ctx.db.select().from(teams).where(eq(teams.id, source.teamId)).get()
				: undefined;
			source.fallback = workspaceLive
				? "workspace"
				: team
					? "team"
					: source.kind === "automation_run"
						? "automations"
						: source.kind === "memory"
							? "memory"
							: null;
			if (
				canFocus &&
				workspaceLive &&
				source.terminalId &&
				liveById.get(source.terminalId) === source.workspaceId
			) {
				const terminal = ctx.db
					.select()
					.from(terminalSessions)
					.where(eq(terminalSessions.id, source.terminalId))
					.get();
				source.terminalLive =
					terminal?.status === "active" &&
					terminal.endedAt === null &&
					terminal.disposeRequestedAt === null &&
					terminal.originWorkspaceId === source.workspaceId;
			}
			return source;
		});
	};
}
