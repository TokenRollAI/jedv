import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	reconcileTerminalPanes,
	type TerminalLayoutStore,
} from "../../components/JedvTerminalWorkspace/layout";
import type { LocalClient } from "../../local-client";
import type { TerminalSession } from "../../types";
import {
	createLayoutPersistenceAdapter,
	type LayoutPersistenceState,
} from "./adapter";

export interface JedvLayoutPersistenceInput {
	client?: LocalClient | null;
	store: TerminalLayoutStore;
	hostUrl: string | null;
	workspaceId: string | null;
	sessions: TerminalSession[];
	sessionsReady: boolean;
}
const adapters = new WeakMap<
	TerminalLayoutStore,
	{
		hostUrl: string;
		workspaceId: string;
		adapter: ReturnType<typeof createLayoutPersistenceAdapter>;
		connection: { client: LocalClient | null };
	}
>();
function adapterFor(
	input: Pick<
		JedvLayoutPersistenceInput,
		"store" | "hostUrl" | "workspaceId" | "client"
	>,
) {
	const { store, hostUrl, workspaceId } = input;
	if (!hostUrl || !workspaceId) return null;
	const existing = adapters.get(store);
	if (existing) {
		if (existing.hostUrl !== hostUrl || existing.workspaceId !== workspaceId)
			throw new Error(
				"A layout store cannot be shared between workspace contexts",
			);
		if (input.client) existing.connection.client = input.client;
		return existing.adapter;
	}
	const connection = { client: input.client ?? null };
	const adapter = createLayoutPersistenceAdapter({
		resolveResumedTerminal: async (terminalId) => {
			const target = connection.client;
			if (!target) return null;
			const successor =
				await target.terminalAgents.resumedSuccessorStrict.query({
					workspaceId,
					terminalId,
				});
			if (connection.client !== target)
				throw new Error(i18n._(msg({ message: "Disconnected" })));
			return successor?.terminalId ?? null;
		},
		store,
		reconcile: reconcileTerminalPanes,
		client: {
			get: () =>
				electronTrpcClient.uiState.workspaceLayouts.get.query({
					hostUrl,
					workspaceId,
				}),
			set: (layout) =>
				electronTrpcClient.uiState.workspaceLayouts.set.mutate({
					hostUrl,
					workspaceId,
					layout,
				}),
		},
	});
	adapters.set(store, { hostUrl, workspaceId, adapter, connection });
	return adapter;
}
export async function ensureJedvLayoutRestored(
	input: JedvLayoutPersistenceInput & { sessionsReady: true },
): Promise<void> {
	const adapter = adapterFor(input);
	if (!adapter)
		throw new Error(
			"A connected host and workspace are required to restore layout",
		);
	adapter.update(input.sessions, true);
	await adapter.start();
	if (!adapter.getState().ready)
		throw (
			adapter.getState().error ??
			new Error("Workspace layout could not be restored")
		);
}
const inactive: LayoutPersistenceState = {
	ready: false,
	status: "loading",
	error: null,
};
const idleSubscribe = () => () => {};
export function useJedvLayoutPersistence(input: JedvLayoutPersistenceInput) {
	const { store, hostUrl, workspaceId, client } = input;
	const adapter = useMemo(
		() => adapterFor({ store, hostUrl, workspaceId, client }),
		[store, hostUrl, workspaceId, client],
	);
	const state = useSyncExternalStore(
		adapter?.subscribe ?? idleSubscribe,
		adapter?.getState ?? (() => inactive),
	);
	useEffect(() => {
		if (!adapter) return;
		adapter.update(input.sessions, input.sessionsReady);
		void adapter.start();
	}, [adapter, input.sessions, input.sessionsReady]);
	useEffect(
		() => () => {
			void adapter?.flush();
		},
		[adapter],
	);
	return {
		...state,
		flush: () => adapter?.flush() ?? Promise.resolve(),
		retry: () => adapter?.retry() ?? Promise.resolve(),
	};
}

export async function flushJedvLayout(
	input: Pick<
		JedvLayoutPersistenceInput,
		"store" | "hostUrl" | "workspaceId" | "client"
	>,
) {
	const adapter = adapterFor(input);
	if (!adapter)
		throw new Error(
			i18n._(
				msg({
					message: "A connected host and workspace are required to save layout",
				}),
			),
		);
	await adapter.flush();
	if (adapter.getState().status === "error")
		throw (
			adapter.getState().error ??
			new Error(i18n._(msg({ message: "Workspace layout could not be saved" })))
		);
}
