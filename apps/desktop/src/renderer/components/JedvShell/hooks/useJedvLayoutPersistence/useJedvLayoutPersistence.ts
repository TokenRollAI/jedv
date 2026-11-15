import { useEffect, useMemo, useSyncExternalStore } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	reconcileTerminalPanes,
	type TerminalLayoutStore,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import {
	createLayoutPersistenceAdapter,
	type LayoutPersistenceState,
} from "./adapter";

export interface JedvLayoutPersistenceInput {
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
	}
>();
function adapterFor(
	input: Pick<JedvLayoutPersistenceInput, "store" | "hostUrl" | "workspaceId">,
) {
	const { store, hostUrl, workspaceId } = input;
	if (!hostUrl || !workspaceId) return null;
	const existing = adapters.get(store);
	if (existing) {
		if (existing.hostUrl !== hostUrl || existing.workspaceId !== workspaceId)
			throw new Error(
				"A layout store cannot be shared between workspace contexts",
			);
		return existing.adapter;
	}
	const adapter = createLayoutPersistenceAdapter({
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
	adapters.set(store, { hostUrl, workspaceId, adapter });
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
	const { store, hostUrl, workspaceId } = input;
	const adapter = useMemo(
		() => adapterFor({ store, hostUrl, workspaceId }),
		[store, hostUrl, workspaceId],
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
