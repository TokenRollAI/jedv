import { toast } from "@jedv/ui/sonner";
import { getEventBus } from "@jedv/workspace-client";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { buildTerminalCommand } from "renderer/lib/terminal/launch-command";
import type { LocalClient } from "../../../../local-client";

const runs = new Map<
	string,
	{
		terminalId: string;
		exited?: boolean;
		exitCode?: number;
		uncertain?: boolean;
	}
>();
const starting = new Set<string>();
export interface ProjectRunOptions {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	projectId: string;
	onTerminal(id: string): Promise<void>;
	onConfigure(): void;
	getWsToken?: () => string | null;
}
export function useProjectRun(options: ProjectRunOptions) {
	const {
		client,
		hostUrl,
		workspaceId,
		projectId,
		onTerminal,
		onConfigure,
		getWsToken,
	} = options;
	const { t } = useLingui();
	const key = `${hostUrl}:${workspaceId}`;
	const current = useRef<string | null>(key);
	current.current = key;
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	const [, update] = useState(0);
	const definition = useQuery({
		queryKey: ["jedv", hostUrl, projectId, "workspace-run"],
		queryFn: () => client.config.getWorkspaceRunDefinition.query({ projectId }),
		retry: false,
		refetchInterval: 10000,
	});
	const record = runs.get(key);
	const status = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"workspace-run-status",
			record?.terminalId,
		],
		enabled: !!record?.terminalId,
		retry: false,
		refetchInterval: 2000,
		queryFn: async () => {
			const terminalId = record?.terminalId;
			if (!terminalId) return { exists: false, running: false };
			const list = await client.terminal.list.query({ workspaceId });
			const exists = list.sessions.some(
				(session) => session.terminalId === terminalId && !session.exited,
			);
			if (!exists) return { exists: false, running: false };
			const process = await client.terminal.hasRunningProcess.query({
				workspaceId,
				terminalId,
			});
			return { exists: true, running: process.running };
		},
	});
	useEffect(() => {
		current.current = key;
		return () => {
			if (current.current === key) current.current = null;
		};
	}, [key]);
	useEffect(() => {
		if (!getWsToken) return;
		const bus = getEventBus(hostUrl, getWsToken),
			release = bus.retain();
		const unsubscribe = bus.on(
			"terminal:lifecycle",
			workspaceId,
			(_id, event) => {
				const known = runs.get(key);
				if (
					event.eventType !== "exit" ||
					known?.terminalId !== event.terminalId
				)
					return;
				runs.set(key, {
					terminalId: event.terminalId,
					exited: true,
					exitCode: event.exitCode,
				});
				if (current.current === key) {
					update((value) => value + 1);
					void status.refetch();
				}
			},
		);
		return () => {
			unsubscribe();
			release();
		};
	}, [hostUrl, workspaceId, key, getWsToken, status.refetch]);
	const remember = (terminalId: string) => {
		runs.delete(key);
		runs.set(key, { terminalId });
		while (runs.size > 32) {
			const oldest = runs.keys().next().value;
			if (oldest) runs.delete(oldest);
		}
		if (current.current === key) update((value) => value + 1);
	};
	const execute = async (
		kind: "run" | "new" | "stop" | "restart" | "open" | "force",
	) => {
		if (starting.has(key) || starting.size >= 32) return;
		starting.add(key);
		setPendingKey(key);
		try {
			let terminalId = runs.get(key)?.terminalId;
			const live = terminalId
				? (await client.terminal.list.query({ workspaceId })).sessions.find(
						(session) => session.terminalId === terminalId && !session.exited,
					)
				: undefined;
			if (!live) terminalId = undefined;
			if (runs.get(key)?.uncertain && !live && kind !== "new")
				throw new Error(
					t({
						message:
							"Launch result unknown. Refresh and inspect the terminal before restarting.",
					}),
				);
			if (kind === "open") {
				if (terminalId && current.current === key) await onTerminal(terminalId);
				return;
			}
			const running = terminalId
				? (
						await client.terminal.hasRunningProcess.query({
							workspaceId,
							terminalId,
						})
					).running
				: false;
			if (kind === "force") {
				if (terminalId)
					await client.terminal.killSession.mutate({ workspaceId, terminalId });
				return;
			}
			if (kind === "stop" || kind === "restart") {
				if (terminalId && running)
					await client.terminal.writeInput.mutate({
						workspaceId,
						terminalId,
						data: "\u0003",
					});
				if (kind === "stop") return;
				if (
					terminalId &&
					(
						await client.terminal.hasRunningProcess.query({
							workspaceId,
							terminalId,
						})
					).running
				)
					throw new Error(
						t({
							message: "The run command is still stopping. Wait, then restart.",
						}),
					);
			}
			if (
				kind === "run" &&
				(running || runs.get(key)?.uncertain) &&
				terminalId
			) {
				if (current.current === key) await onTerminal(terminalId);
				return;
			}
			if (current.current !== key) return;
			if (!definition.isSuccess)
				throw (
					definition.error ??
					new Error(t({ message: "Run configuration is not available" }))
				);
			const command = buildTerminalCommand(definition.data?.commands);
			if (!command) {
				onConfigure();
				return;
			}
			if (terminalId && kind !== "new")
				await client.terminal.writeInput.mutate({
					workspaceId,
					terminalId,
					data: `${command}\r`,
				});
			else {
				terminalId = crypto.randomUUID();
				remember(terminalId);
				runs.set(key, { terminalId, uncertain: true });
				const session = await client.terminal.launchSession.mutate({
					workspaceId,
					terminalId,
					initialCommand: command,
					cwd: definition.data?.cwd,
				});
				terminalId = session.terminalId;
			}
			remember(terminalId);
			await client.terminal.rename.mutate({
				workspaceId,
				terminalId,
				title: t({ message: "Run" }),
			});
			if (current.current === key) await onTerminal(terminalId);
		} catch (error) {
			if (current.current === key)
				toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			starting.delete(key);
			if (current.current === key) {
				setPendingKey(null);
				void status.refetch();
			}
		}
	};
	return {
		definition,
		status,
		record,
		pending: pendingKey === key || starting.has(key),
		execute,
	};
}
