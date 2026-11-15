import { useLingui } from "@lingui/react/macro";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	AGENT_ISLAND_EVENTS,
	type AgentIslandApprovalEvent,
	type AgentIslandEntry,
	type AgentIslandFocusEvent,
} from "shared/types/agent-island";
import type { LocalClient } from "../../local-client";
import type { NativeState, Project, Workspace } from "../../types";
import { executeIslandApproval } from "./approval";
import { applyAttentionReadThrough } from "./attention";
import {
	bindingAttentionEvent,
	isIslandProvider,
	islandPriority,
	snapshotEntry,
} from "./snapshot";

type Binding = Awaited<
	ReturnType<LocalClient["terminalAgents"]["list"]["query"]>
>[number];
type IslandSnapshot = {
	hostId: string;
	generation: number;
	entries: AgentIslandEntry[];
};
type Reference = {
	entryId: string;
	workspaceId: string;
	provider: AgentIslandEntry["provider"];
	nativeSessionId?: string;
	terminalId?: string;
	agentConfigId?: string;
	chatSessionId?: string;
	bindingTerminalId?: string;
	profileHash?: string;
	leaseEpoch?: number;
};
export function useAgentIslandBridge(input: {
	client: LocalClient | null;
	hostId: string | null;
	projects: Project[];
	workspaces: Workspace[];
	bindings: Binding[];
	nativeState: NativeState | null;
	activeWorkspaceId: string | null;
	onFocus(
		event: AgentIslandFocusEvent & {
			chatSessionId?: string;
			bindingTerminalId?: string;
			agentConfigId?: string;
			unavailable?: boolean;
		},
	): Promise<void>;
}) {
	const { t } = useLingui();
	const current = useRef(input);
	current.current = input;
	const refs = useRef(new Map<string, Reference>());
	const previous = useRef(new Map<string, AgentIslandEntry>());
	const generation = useRef({
		client: input.client,
		hostId: input.hostId,
		value: 0,
	});
	if (
		generation.current.client !== input.client ||
		generation.current.hostId !== input.hostId
	) {
		generation.current = {
			client: input.client,
			hostId: input.hostId,
			value: generation.current.value + 1,
		};
		refs.current.clear();
		previous.current.clear();
	}
	const connectionVersion = generation.current.value;
	const cache = useQueryClient();
	const snapshotKey = useMemo(
		() => ["jedv", input.hostId, "island-snapshot", connectionVersion] as const,
		[input.hostId, connectionVersion],
	);
	const state = electronTrpc.agentIsland.getState.useQuery(undefined, {
		refetchInterval: 3_000,
	});
	const utils = electronTrpc.useUtils();
	const utilsRef = useRef(utils);
	utilsRef.current = utils;
	const snapshot = useQuery({
		queryKey: snapshotKey,
		queryFn:
			input.client && input.hostId
				? async (): Promise<IslandSnapshot | null> => {
						const source = current.current;
						if (!source.client || !source.hostId) return null;
						const authenticatedClient = source.client;
						const terminalLists = await Promise.allSettled(
							[
								...new Set(
									source.bindings
										.slice(0, 32)
										.map((binding) => binding.workspaceId),
								),
							].map(async (workspaceId) => ({
								workspaceId,
								sessions: (
									await authenticatedClient.terminal.list.query({ workspaceId })
								).sessions,
							})),
						);
						const realTerminals = new Map(
							terminalLists.flatMap((result) =>
								result.status === "fulfilled"
									? [
											[
												result.value.workspaceId,
												new Set(
													result.value.sessions.map(
														(session) => session.terminalId,
													),
												),
											] as const,
										]
									: [],
							),
						);
						for (const binding of source.bindings.slice(0, 32)) {
							if (
								!isIslandProvider(binding.agentId) ||
								!source.workspaces.some(
									(workspace) => workspace.id === binding.workspaceId,
								)
							)
								continue;
							refs.current.set(binding.terminalId, {
								entryId: binding.terminalId,
								workspaceId: binding.workspaceId,
								provider: binding.agentId,
								terminalId: realTerminals
									.get(binding.workspaceId)
									?.has(binding.terminalId)
									? binding.terminalId
									: undefined,
								nativeSessionId: binding.agentSessionId,
								agentConfigId: binding.definitionId,
								chatSessionId: binding.chatSessionId,
								bindingTerminalId: binding.terminalId,
							});
						}
						if (source.nativeState?.nativeSessionId) {
							const native = source.nativeState;
							const existing = [...refs.current.values()].find(
								(ref) =>
									ref.workspaceId === native.workspaceId &&
									ref.provider === native.provider &&
									ref.nativeSessionId === native.nativeSessionId,
							);
							const entryId =
								existing?.entryId ?? native.terminalId ?? crypto.randomUUID();
							refs.current.set(entryId, {
								entryId,
								workspaceId: native.workspaceId,
								provider: native.provider,
								nativeSessionId: native.nativeSessionId ?? undefined,
								terminalId:
									native.terminalId &&
									realTerminals.get(native.workspaceId)?.has(native.terminalId)
										? native.terminalId
										: undefined,
								agentConfigId: existing?.agentConfigId,
							});
						}
						const candidates = [...refs.current.values()]
							.filter((ref) =>
								source.workspaces.some(
									(workspace) => workspace.id === ref.workspaceId,
								),
							)
							.sort(
								(a, b) =>
									islandPriority(
										previous.current.get(a.entryId) ?? {
											pendingApprovals: [],
											turnState: "unknown",
											completedUnread: false,
										},
									) -
									islandPriority(
										previous.current.get(b.entryId) ?? {
											pendingApprovals: [],
											turnState: "unknown",
											completedUnread: false,
										},
									),
							)
							.slice(0, 32);
						refs.current = new Map(candidates.map((ref) => [ref.entryId, ref]));
						const results = await Promise.allSettled(
							candidates.map(async (ref) => {
								const workspace = source.workspaces.find(
									(item) => item.id === ref.workspaceId,
								);
								if (!workspace) return null;
								const native =
									await authenticatedClient.terminalAgents.queryNativeSession
										.query({
											workspaceId: ref.workspaceId,
											provider: ref.provider,
											nativeSessionId: ref.nativeSessionId,
											terminalId: ref.bindingTerminalId ?? ref.terminalId,
											agentConfigId: ref.agentConfigId,
										})
										.catch(() => null);
								if (!native)
									return {
										entryId: ref.entryId,
										workspaceId: workspace.id,
										workspaceName: (workspace.name || workspace.branch).slice(
											0,
											160,
										),
										projectName: (
											source.projects.find(
												(project) => project.id === workspace.projectId,
											)?.name ?? ""
										).slice(0, 160),
										provider: ref.provider,
										nativeSessionId: ref.nativeSessionId ?? null,
										profileHash: null,
										agentConfigId: ref.agentConfigId,
										terminalId: ref.terminalId ?? null,
										activeWriter: "none" as const,
										leaseEpoch: 0,
										turnState: "unknown" as const,
										completedUnread: false,
										pendingApprovals: [],
									};
								if (
									current.current.client === source.client &&
									current.current.hostId === source.hostId
								)
									refs.current.set(ref.entryId, {
										...ref,
										nativeSessionId: native.nativeSessionId ?? undefined,
										profileHash: native.profileHash ?? undefined,
										leaseEpoch: native.leaseEpoch,
										chatSessionId: native.chatSessionId ?? ref.chatSessionId,
									});
								return snapshotEntry({
									entryId: ref.entryId,
									state: { ...native, terminalId: ref.terminalId ?? null },
									workspace,
									project: source.projects.find(
										(project) => project.id === workspace.projectId,
									),
									agentConfigId: ref.agentConfigId,
									previous: previous.current.get(ref.entryId),
									event: bindingAttentionEvent(
										source.bindings.find(
											(binding) =>
												binding.terminalId ===
												(ref.bindingTerminalId ?? ref.entryId),
										),
										native.provider,
										native.nativeSessionId,
									),
								});
							}),
						);
						if (
							current.current.client !== source.client ||
							current.current.hostId !== source.hostId
						)
							return null;
						const entries = results
							.flatMap((result) =>
								result.status === "fulfilled" && result.value
									? [result.value]
									: [],
							)
							.sort((a, b) => islandPriority(a) - islandPriority(b));
						previous.current = new Map(
							entries.map((entry) => [entry.entryId, entry]),
						);
						return {
							hostId: source.hostId,
							generation: connectionVersion,
							entries,
						};
					}
				: skipToken,
		enabled: !!input.client && !!input.hostId,
		refetchInterval: 3_000,
		retry: false,
	});
	const refresh = useRef(() => snapshot.refetch());
	refresh.current = () => snapshot.refetch();
	useEffect(() => {
		const focus = (event: AgentIslandFocusEvent) => {
			const source = current.current;
			if (
				source.hostId !== event.hostId ||
				!source.workspaces.some((item) => item.id === event.workspaceId)
			)
				return;
			const ref = refs.current.get(event.entryId);
			const matches =
				ref &&
				ref.workspaceId === event.workspaceId &&
				ref.provider === event.provider &&
				(ref.nativeSessionId ?? null) === event.nativeSessionId;
			void source
				.onFocus(
					matches
						? {
								...event,
								chatSessionId: ref.chatSessionId,
								bindingTerminalId: ref.bindingTerminalId,
								agentConfigId: ref.agentConfigId,
							}
						: {
								...event,
								terminalId: null,
								nativeSessionId: null,
								unavailable: true,
							},
				)
				.catch(() => {});
		};
		const approve = (event: AgentIslandApprovalEvent) => {
			void executeIslandApproval(event, {
				connection: () => {
					const source = current.current;
					return source.client && source.hostId
						? { client: source.client, hostId: source.hostId }
						: null;
				},
				complete: (result) =>
					electronTrpcClient.agentIsland.completeApproval.mutate(result),
				refresh: () => refresh.current(),
			});
		};
		window.ipcRenderer.on(AGENT_ISLAND_EVENTS.focusTerminal, focus);
		window.ipcRenderer.on(AGENT_ISLAND_EVENTS.approval, approve);
		return () => {
			window.ipcRenderer.off(AGENT_ISLAND_EVENTS.focusTerminal, focus);
			window.ipcRenderer.off(AGENT_ISLAND_EVENTS.approval, approve);
		};
	}, []);
	useEffect(() => {
		if (!input.hostId || !input.client) return;
		let cancelled = false;
		void electronTrpcClient.agentIsland.bindHost
			.mutate({ hostId: input.hostId })
			.then((result) => {
				if (cancelled) return;
				utilsRef.current.agentIsland.getState.setData(undefined, result);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [input.hostId, input.client]);
	useEffect(() => {
		const data = snapshot.data;
		if (
			!input.client ||
			!input.hostId ||
			!data ||
			data.hostId !== input.hostId ||
			data.generation !== connectionVersion
		)
			return;
		const hostId = input.hostId,
			client = input.client;
		void electronTrpcClient.agentIsland.publishSnapshot
			.mutate({ hostId, entries: data.entries })
			.then((result) => {
				if (
					current.current.hostId !== hostId ||
					current.current.client !== client
				)
					return;
				const floors = result.attentionReadThrough ?? {};
				const updated = applyAttentionReadThrough(
					[...previous.current.values()],
					data.entries,
					floors,
					result.attentionReadEntryIds ?? [],
				);
				previous.current = new Map(
					updated.map((entry) => [entry.entryId, entry]),
				);
				cache.setQueryData<IslandSnapshot | null>(snapshotKey, (value) => {
					if (
						!value ||
						value.hostId !== hostId ||
						value.generation !== connectionVersion
					)
						return value;
					const entries = applyAttentionReadThrough(
						value.entries,
						data.entries,
						floors,
						result.attentionReadEntryIds ?? [],
					);
					return entries.every((entry, index) => entry === value.entries[index])
						? value
						: { ...value, entries };
				});
			})
			.catch(() => {});
	}, [
		input.hostId,
		input.client,
		snapshot.data,
		connectionVersion,
		cache,
		snapshotKey,
	]);
	useEffect(() => {
		if (!input.hostId || !input.client) return;
		const hostId = input.hostId;
		return () => {
			void electronTrpcClient.agentIsland.publishSnapshot
				.mutate({ hostId, entries: [] })
				.catch(() => {});
		};
	}, [input.hostId, input.client]);
	useEffect(() => {
		if (!input.client || !input.hostId) return;
		const activeWorkspaceId = input.activeWorkspaceId;
		const refreshVisible = () => {
			if (current.current.activeWorkspaceId === activeWorkspaceId)
				void refresh.current();
		};
		window.addEventListener("focus", refreshVisible);
		window.addEventListener("focusin", refreshVisible);
		void refresh.current();
		return () => {
			window.removeEventListener("focus", refreshVisible);
			window.removeEventListener("focusin", refreshVisible);
		};
	}, [input.client, input.hostId, input.activeWorkspaceId]);
	const data = snapshot.data;
	const available =
		!!input.client &&
		!!input.hostId &&
		!!data &&
		data.hostId === input.hostId &&
		data.generation === connectionVersion &&
		!snapshot.isError;
	const agentSource = available
		? { status: "ready" as const, entries: data.entries }
		: {
				status: "unavailable" as const,
				reason:
					snapshot.error?.message ??
					(!input.client
						? t({ message: "Host connection is unavailable" })
						: t({ message: "Agent activity is loading or unavailable" })),
			};
	const focusEntry = async (entryId: string): Promise<void> => {
		const source = current.current;
		if (
			!available ||
			!data ||
			data.hostId !== source.hostId ||
			source.client !== input.client
		)
			throw new Error(
				t({
					message:
						"Agent activity changed. Refresh before opening the session.",
				}),
			);
		const entry = data.entries.find((item) => item.entryId === entryId),
			ref = refs.current.get(entryId);
		if (
			!entry ||
			!ref ||
			ref.workspaceId !== entry.workspaceId ||
			ref.provider !== entry.provider ||
			(ref.nativeSessionId ?? null) !== entry.nativeSessionId ||
			(entry.profileHash !== null &&
				(ref.profileHash !== entry.profileHash ||
					ref.leaseEpoch !== entry.leaseEpoch))
		)
			throw new Error(t({ message: "Agent session is no longer available" }));
		await source.onFocus({
			entryId,
			hostId: data.hostId,
			workspaceId: entry.workspaceId,
			terminalId: entry.terminalId,
			nativeSessionId: entry.nativeSessionId,
			provider: entry.provider,
			chatSessionId: ref.chatSessionId,
			bindingTerminalId: ref.bindingTerminalId,
			agentConfigId: ref.agentConfigId,
			unavailable: !entry.terminalId && entry.turnState === "unknown",
		});
	};
	return {
		state: state.data,
		refresh: () => snapshot.refetch(),
		agentSource,
		focusEntry,
	};
}
