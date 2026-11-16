import { getEventBus } from "@jedv/workspace-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { TerminalLayoutStore } from "../../components/JedvTerminalWorkspace/layout";
import type { LocalClient } from "../../local-client";
import type { TerminalSession } from "../../types";
import { createResumedTerminalPaneController } from "./controller";

export interface ResumedTerminalPanesInput {
	client: LocalClient | null;
	hostUrl: string | null;
	workspaceId: string | null;
	store: TerminalLayoutStore;
	sessions: readonly TerminalSession[];
	sessionsReady: boolean;
	layoutReady: boolean;
	connected: boolean;
	getWsToken?: () => string | null;
}
export function useResumedTerminalPanes(input: ResumedTerminalPanesInput) {
	const cache = useQueryClient();
	const latest = useRef(input);
	latest.current = input;
	const controller = useRef<ReturnType<
		typeof createResumedTerminalPaneController
	> | null>(null);
	const { client, hostUrl, workspaceId, store } = input;
	const hasEventToken = !!input.getWsToken;
	useEffect(() => {
		if (!client || !hostUrl || !workspaceId) return;
		let alive = true,
			reportedError = false;
		const isCurrent = () =>
			alive &&
			latest.current.client === client &&
			latest.current.hostUrl === hostUrl &&
			latest.current.workspaceId === workspaceId &&
			latest.current.store === store;
		const refresh = () => {
			if (!isCurrent()) return;
			void cache.invalidateQueries({
				queryKey: ["jedv", hostUrl, "terminals", workspaceId],
			});
			void cache.invalidateQueries({ queryKey: ["jedv", hostUrl, "bindings"] });
		};
		const service = createResumedTerminalPaneController({
			store,
			workspaceId,
			isCurrent,
			lookup: (terminalId, signal) =>
				client.terminalAgents.resumedSuccessorStrict.query(
					{ workspaceId, terminalId },
					{ signal },
				),
			onRebound: () => {
				reportedError = false;
				refresh();
			},
			onError: (error) => {
				if (!reportedError)
					console.warn(
						"[resumed-terminal-panes] strict successor lookup failed",
						error,
					);
				reportedError = true;
			},
		});
		controller.current = service;
		service.update(latest.current);
		let release = () => {},
			offLifecycle = () => {},
			offStatus = () => {};
		if (hasEventToken) {
			const bus = getEventBus(hostUrl, () =>
				isCurrent() ? (latest.current.getWsToken?.() ?? null) : null,
			);
			release = bus.retain();
			offLifecycle = bus.on(
				"terminal:lifecycle",
				workspaceId,
				(eventWorkspace, event) => {
					if (
						!isCurrent() ||
						eventWorkspace !== workspaceId ||
						event.eventType !== "resumed"
					)
						return;
					// resumedTerminalId is a hint only; the strict query owns the mapping.
					service.resumed(eventWorkspace, event.terminalId);
					refresh();
				},
			);
			let state = bus.getConnectionStatus().state;
			offStatus = bus.subscribeConnectionStatus((next) => {
				if (next.state === "open" && state !== "open") {
					service.reconnected();
					refresh();
				}
				state = next.state;
			});
		}
		return () => {
			alive = false;
			service.dispose();
			offLifecycle();
			offStatus();
			release();
			if (controller.current === service) controller.current = null;
		};
	}, [client, hostUrl, workspaceId, store, hasEventToken, cache]);
	useEffect(() => {
		controller.current?.update({
			connected: input.connected,
			sessionsReady: input.sessionsReady,
			layoutReady: input.layoutReady,
			sessions: input.sessions,
		});
	}, [input.connected, input.sessionsReady, input.layoutReady, input.sessions]);
}
