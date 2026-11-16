import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import { useEffect, useMemo, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	retainTerminalWorkspaceStore,
	terminalWorkspaceStore,
} from "../../components/JedvTerminalWorkspace/layout";
import {
	createLocalClient,
	hostBaseUrl,
	type LocalConnection,
} from "../../local-client";
import {
	ensureJedvLayoutRestored,
	flushJedvLayout,
} from "../useJedvLayoutPersistence";
import { createPaneLayoutController } from "./controller";
import { PaneOperationError } from "./operations";

export function usePaneLayoutBridge(input: {
	localConnection: LocalConnection | null;
	/** Null when the window shows a private host, even if workspace IDs match. */
	activeWorkspaceId: string | null;
	onFocusWorkspace(workspaceId: string): Promise<void>;
	getSidebarFullScreen?(workspaceId: string): boolean;
}) {
	const { port, secret, machineId, baseUrl } = input.localConnection ?? {};
	const local = useMemo(
		() =>
			port !== undefined && secret !== undefined && machineId !== undefined
				? { port, secret, machineId, baseUrl }
				: null,
		[port, secret, machineId, baseUrl],
	);
	const client = useMemo(
		() => (local ? createLocalClient(local) : null),
		[local],
	);
	const current = useRef({ client, ...input });
	current.current = { client, ...input };
	useEffect(() => {
		if (!local || !client) return;
		const hostUrl = hostBaseUrl(local);
		let mounted = true;
		const isCurrent = () => mounted && current.current.client === client;
		const assertCurrent = () => {
			if (!isCurrent())
				throw new PaneOperationError(
					"PRECONDITION_FAILED",
					i18n._(
						msg({
							message:
								"The local host connection changed. Inspect the layout before retrying.",
						}),
					),
				);
		};
		const controller = createPaneLayoutController({
			isCurrent,
			load: async (workspaceId) => {
				const workspaces = await client.workspace.list.query();
				assertCurrent();
				if (!workspaces.some((workspace) => workspace.id === workspaceId))
					throw new PaneOperationError(
						"NOT_FOUND",
						i18n._(msg({ message: "Workspace not found" })),
					);
				const { sessions } = await client.terminal.list.query({ workspaceId });
				assertCurrent();
				const store = terminalWorkspaceStore(`${hostUrl}:${workspaceId}`);
				const release = retainTerminalWorkspaceStore(store);
				try {
					await ensureJedvLayoutRestored({
						client,
						store,
						hostUrl,
						workspaceId,
						sessions,
						sessionsReady: true,
					});
					assertCurrent();
					return {
						store,
						sessions,
						release,
						flush: () => flushJedvLayout({ store, hostUrl, workspaceId }),
					};
				} catch (error) {
					release();
					throw error;
				}
			},
			focusWorkspace: (workspaceId) =>
				current.current.onFocusWorkspace(workspaceId),
			getSidebarFullScreen: (workspaceId) =>
				current.current.getSidebarFullScreen?.(workspaceId) ?? false,
			respond: (reply) => electronTrpcClient.paneLayout.respond.mutate(reply),
			onTransportError: (error) =>
				console.warn("[pane-layout] reply could not be delivered", error),
		});
		const bind = () => {
			if (isCurrent())
				void electronTrpcClient.paneLayout.bindWorkspace
					.mutate({ workspaceId: current.current.activeWorkspaceId })
					.catch((error) =>
						console.warn("[pane-layout] workspace registration failed", error),
					);
		};
		const subscription = electronTrpcClient.paneLayout.onRequest.subscribe(
			undefined,
			{
				onData: (request) => {
					void controller.enqueue(request);
				},
				onStarted: bind,
				onError: (error) =>
					console.warn("[pane-layout] subscription failed", error),
			},
		);
		return () => {
			mounted = false;
			controller.dispose();
			subscription.unsubscribe();
		};
	}, [local, client]);
	useEffect(() => {
		if (!client) return;
		void electronTrpcClient.paneLayout.bindWorkspace
			.mutate({ workspaceId: input.activeWorkspaceId })
			.catch((error) =>
				console.warn("[pane-layout] workspace registration failed", error),
			);
	}, [client, input.activeWorkspaceId]);
}
