import { createWorkspaceStore } from "@jedv/panes";
import {
	decodeWorkspaceLayout,
	encodeWorkspaceLayout,
	type JedvWorkspaceLayout,
} from "shared/jedv-workspace-layout";
import {
	type TerminalLayoutStore,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import {
	missingSavedTerminals,
	resolveSavedTerminalSuccessors,
} from "../useResumedTerminalPanes/restore";

export interface LayoutPersistenceClient {
	get(): Promise<JedvWorkspaceLayout | null>;
	set(layout: JedvWorkspaceLayout): Promise<unknown>;
}
export interface LayoutPersistenceState {
	ready: boolean;
	status: "loading" | "ready" | "saving" | "error";
	error: Error | null;
}
export function createLayoutPersistenceAdapter(input: {
	store: TerminalLayoutStore;
	client: LayoutPersistenceClient;
	reconcile(store: TerminalLayoutStore, sessions: TerminalSession[]): void;
	resolveResumedTerminal?(terminalId: string): Promise<string | null>;
}) {
	const { store, client } = input;
	const areas = workspacePaneAreas(store);
	let state: LayoutPersistenceState = {
		ready: false,
		status: "loading",
		error: null,
	};
	const listeners = new Set<() => void>();
	let load: Promise<void> | null = null;
	let loaded = false;
	let restoring: Promise<void> | null = null;
	let sessionsReady = false;
	let sessions: TerminalSession[] = [];
	let ownChange = false;
	let edited =
		store.getState().tabs.length > 0 || areas.right.getState().tabs.length > 0;
	let flagsEdited =
		areas.state.getState().rightAreaOpen ||
		!areas.state.getState().activityDockHidden;
	let saved: JedvWorkspaceLayout | null = null;
	let lastSaved: string | null = null;
	let pending: JedvWorkspaceLayout | null = null;
	let writing: Promise<void> | null = null;
	let sending: string | null = null;
	let identityOverflow = false;
	const known = new Set<string>();
	const remember = (key: string) => {
		if (!known.has(key) && known.size >= 512) {
			identityOverflow = true;
			return;
		}
		known.add(key);
	};
	const present = () =>
		new Set(
			[...store.getState().tabs, ...areas.right.getState().tabs].flatMap(
				(tab) =>
					Object.values(tab.panes).flatMap((pane) =>
						"terminalId" in pane.data ? [pane.data.terminalId] : [],
					),
			),
		);
	const notify = (next: LayoutPersistenceState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	const fail = (error: unknown) =>
		notify({
			ready: state.ready,
			status: "error",
			error: error instanceof Error ? error : new Error(String(error)),
		});
	const snapshot = () => {
		const attached = present();
		for (const key of attached) remember(key);
		if (identityOverflow)
			throw new Error("Workspace terminal identity limit reached");
		const left = encodeWorkspaceLayout(
			store.getState(),
			[...known].filter((key) => !attached.has(key)),
		);
		const right = encodeWorkspaceLayout(areas.right.getState(), []);
		const flags = areas.state.getState();
		return decodeWorkspaceLayout({
			...left,
			...(right.tabs.length
				? {
						rightArea: {
							version: 1,
							tabs: right.tabs,
							activeTabId: right.activeTabId,
						},
					}
				: {}),
			...(flags.rightAreaOpen ? { rightAreaOpen: true } : {}),
			...(!flags.activityDockHidden ? { activityDockHidden: false } : {}),
		});
	};
	async function flush(): Promise<void> {
		if (writing) return writing;
		if (!pending || !state.ready) return;
		const run = async () => {
			while (pending) {
				const current = pending;
				pending = null;
				sending = JSON.stringify(current);
				notify({ ready: true, status: "saving", error: null });
				try {
					await client.set(current);
					lastSaved = JSON.stringify(current);
				} catch (error) {
					pending ??= current;
					fail(error);
					return;
				}
			}
			notify({ ready: true, status: "ready", error: null });
		};
		writing = run().finally(() => {
			writing = null;
			sending = null;
		});
		return writing;
	}
	function queueSave() {
		if (!state.ready) return;
		try {
			const next = snapshot();
			const serialized = JSON.stringify(next);
			if (
				serialized ===
				(pending ? JSON.stringify(pending) : (sending ?? lastSaved))
			)
				return;
			if (serialized === sending || (!writing && serialized === lastSaved)) {
				pending = null;
				return;
			}
			pending = next;
			void flush();
		} catch (error) {
			fail(error);
		}
	}
	function reconcile() {
		if (!state.ready || !sessionsReady || sessions.length === 0) return;
		const attached = present();
		const detached = new Set([...known].filter((key) => !attached.has(key)));
		for (const session of sessions) remember(session.terminalId);
		ownChange = true;
		try {
			input.reconcile(
				store,
				sessions.filter((session) => !detached.has(session.terminalId)),
			);
		} finally {
			ownChange = false;
		}
		queueSave();
	}
	function applyRestore() {
		if (!loaded || !sessionsReady || state.ready) return;
		if (saved) {
			const liveDetached = new Set(
				sessions.map((session) => session.terminalId),
			);
			for (const key of saved.detachedTerminalIds)
				if (liveDetached.has(key)) remember(key);
			if (!edited) {
				ownChange = true;
				try {
					const live = new Set(sessions.map((session) => session.terminalId));
					if (saved.rightArea) {
						const right =
							createWorkspaceStore<
								(typeof saved.tabs)[number]["panes"][string]["data"]
							>();
						right.setState({
							tabs: saved.rightArea.tabs,
							activeTabId: saved.rightArea.activeTabId,
						});
						for (const tab of saved.rightArea.tabs)
							for (const pane of Object.values(tab.panes))
								if (
									"terminalId" in pane.data &&
									!live.has(pane.data.terminalId)
								)
									right.getState().closePane({
										tabId: tab.id,
										paneId: pane.id,
										intent: "remove",
									});
						areas.right.setState({
							tabs: right.getState().tabs,
							activeTabId: right.getState().activeTabId,
						});
					}
					if (!flagsEdited)
						areas.state.setState({
							rightAreaOpen: saved.rightAreaOpen ?? false,
							activityDockHidden: saved.activityDockHidden ?? true,
						});
					const temporary =
						createWorkspaceStore<
							(typeof saved.tabs)[number]["panes"][string]["data"]
						>();
					temporary.setState({
						tabs: saved.tabs,
						activeTabId: saved.activeTabId,
					});
					for (const tab of saved.tabs)
						for (const pane of Object.values(tab.panes))
							if ("terminalId" in pane.data && !live.has(pane.data.terminalId))
								temporary.getState().closePane({
									tabId: tab.id,
									paneId: pane.id,
									intent: "remove",
								});
					store.setState({
						tabs: temporary.getState().tabs,
						activeTabId: temporary.getState().activeTabId,
					});
				} finally {
					ownChange = false;
				}
			}
		}
		for (const key of present()) remember(key);
		notify({ ready: true, status: "ready", error: null });
		reconcile();
		if (edited || saved) queueSave();
	}
	function finishRestore(): Promise<void> {
		if (!loaded || !sessionsReady || state.ready) return Promise.resolve();
		if (restoring) return restoring;
		const resolveResumedTerminal = input.resolveResumedTerminal;
		const missing =
			saved && !edited ? missingSavedTerminals(saved, sessions) : [];
		if (!saved || !resolveResumedTerminal || !missing.length) {
			applyRestore();
			return Promise.resolve();
		}
		const original = saved;
		notify({ ready: false, status: "loading", error: null });
		restoring = resolveSavedTerminalSuccessors({
			layout: original,
			missing,
			resolveResumedTerminal,
			getSessions: () => sessions,
		})
			.then((resolved) => {
				// A late lookup never replaces a layout the user edited meanwhile.
				if (!sessionsReady) return;
				if (!edited) saved = resolved;
				applyRestore();
			})
			.catch((error) => {
				if (edited && sessionsReady) applyRestore();
				else fail(error);
			})
			.finally(() => {
				restoring = null;
			});
		return restoring;
	}
	let saveQueued = false;
	const scheduleSave = () => {
		if (ownChange || saveQueued) return;
		saveQueued = true;
		queueMicrotask(() => {
			saveQueued = false;
			queueSave();
		});
	};
	for (const area of [store, areas.right])
		area.subscribe((next, previous) => {
			if (
				ownChange ||
				(next.tabs === previous.tabs &&
					next.activeTabId === previous.activeTabId)
			)
				return;
			for (const tab of previous.tabs)
				for (const pane of Object.values(tab.panes))
					if ("terminalId" in pane.data) remember(pane.data.terminalId);
			edited = true;
			scheduleSave();
		});
	areas.state.subscribe(() => {
		if (!ownChange) flagsEdited = true;
		scheduleSave();
	});

	async function start() {
		if (loaded) return finishRestore();
		if (load) return load;
		notify({ ready: false, status: "loading", error: null });
		load = (async () => {
			try {
				const raw = await client.get();
				saved = raw === null ? null : decodeWorkspaceLayout(raw);
				lastSaved = saved === null ? null : JSON.stringify(saved);
				loaded = true;
				await finishRestore();
			} catch (error) {
				fail(error);
			}
		})().finally(() => {
			load = null;
		});
		return load;
	}
	return {
		getState: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		update(nextSessions: TerminalSession[], ready: boolean) {
			sessions = nextSessions;
			sessionsReady = ready;
			if (state.ready && ready) {
				const live = new Set(nextSessions.map((session) => session.terminalId));
				const attached = present();
				identityOverflow = false;
				for (const key of known)
					if (!live.has(key) && !attached.has(key)) known.delete(key);
			}
			void finishRestore();
			reconcile();
		},
		start,
		flush: async () => {
			await Promise.resolve();
			await flush();
		},
		async retry() {
			if (!loaded) await start();
			else if (!state.ready) await finishRestore();
			else {
				queueSave();
				await flush();
			}
		},
	};
}
