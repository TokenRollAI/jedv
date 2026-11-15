import { useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { hostOriginSchema, type JedvNavigationState } from "shared/main-events";
export type NavigationState = JedvNavigationState;
const empty: NavigationState = {
	hostUrl: null,
	workspaceId: null,
	terminalId: null,
	sidebarCollapsed: false,
	collapsedProjects: [],
	collapsedGroups: [],
	workspaceSortMode: "manual",
};
export function parseNavigation(value: string | null): NavigationState {
	try {
		const raw = JSON.parse(value ?? "null");
		if (!raw || typeof raw !== "object") return empty;
		return {
			hostUrl: hostOriginSchema.safeParse(raw.hostUrl).success
				? raw.hostUrl
				: null,
			workspaceId:
				typeof raw.workspaceId === "string"
					? raw.workspaceId.slice(0, 128)
					: null,
			terminalId:
				typeof raw.terminalId === "string"
					? raw.terminalId.slice(0, 128)
					: null,
			sidebarCollapsed: raw.sidebarCollapsed === true,
			collapsedProjects: Array.isArray(raw.collapsedProjects)
				? raw.collapsedProjects
						.filter((id: unknown) => typeof id === "string" && id.length <= 128)
						.slice(0, 64)
				: [],
			collapsedGroups: Array.isArray(raw.collapsedGroups)
				? [
						...new Set<string>(
							(raw.collapsedGroups as unknown[]).filter(
								(key: unknown): key is string =>
									typeof key === "string" &&
									key.length > 0 &&
									key.length <= 4096,
							),
						),
					].slice(-128)
				: [],
			workspaceSortMode: ["manual", "active", "created"].includes(
				raw.workspaceSortMode,
			)
				? raw.workspaceSortMode
				: "manual",
		};
	} catch {
		return empty;
	}
}
export function useJedvNavigation() {
	const key = electronTrpc.window.getWindowKey.useQuery();
	const saved = electronTrpc.uiState.navigation.get.useQuery(undefined, {
		retry: false,
	});
	const [state, setState] = useState<NavigationState>(empty);
	const [restored, setRestored] = useState(false);
	const previous = useRef<NavigationState | null>(null);
	const pending = useRef<NavigationState | null>(null);
	const writing = useRef(false);
	const [writeError, setWriteError] = useState<Error | null>(null);
	useEffect(() => {
		if (!restored && saved.isSuccess) {
			const next = parseNavigation(JSON.stringify(saved.data));
			previous.current = next;
			setState(next);
			setRestored(true);
		}
	}, [saved.isSuccess, saved.data, restored]);
	useEffect(() => {
		if (!restored || previous.current === state) return;
		previous.current = state;
		pending.current = state;
		if (writing.current) return;
		writing.current = true;
		void (async () => {
			try {
				while (pending.current) {
					const next = pending.current;
					pending.current = null;
					await electronTrpcClient.uiState.navigation.set.mutate(next);
				}
				setWriteError(null);
			} catch (error) {
				setWriteError(
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				writing.current = false;
			}
		})();
	}, [restored, state]);
	return [
		state,
		setState,
		{
			ready: restored || saved.isError,
			windowKey: key.data,
			error: saved.error ?? writeError,
		},
	] as const;
}
