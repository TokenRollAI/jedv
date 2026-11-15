import { i18n } from "@jedv/i18n";
import {
	createWorkspaceStore,
	type Pane,
	type Tab,
	transferPaneToNewTab,
	type WorkspaceStore,
} from "@jedv/panes";
import { msg } from "@lingui/core/macro";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { TerminalSession } from "../../types";

export type TerminalPaneData = { terminalId: string };
export type WorkspacePaneData =
	| TerminalPaneData
	| { url: string }
	| { view: "changes" | "files" };
export type TerminalLayoutStore = StoreApi<WorkspaceStore<WorkspacePaneData>>;

export function isTerminalPane(
	pane: Pane<WorkspacePaneData> | null | undefined,
): pane is Pane<TerminalPaneData> {
	return (
		pane?.kind === "terminal" &&
		"terminalId" in pane.data &&
		typeof pane.data.terminalId === "string"
	);
}

export function paneTerminalId(
	pane: Pane<WorkspacePaneData> | null | undefined,
): string | null {
	return isTerminalPane(pane) ? pane.data.terminalId : null;
}
export function terminalPaneKey(
	pane: Pick<Pane<WorkspacePaneData>, "kind" | "data">,
): string | undefined {
	return pane.kind === "terminal" && "terminalId" in pane.data
		? pane.data.terminalId
		: undefined;
}

interface ClosedTab {
	tab: Tab<WorkspacePaneData>;
}
interface LayoutMetadata {
	detached: Set<string>;
	closed: ClosedTab[];
	initialized: boolean;

	disposed: boolean;
	retainers: number;
}

const metadata = new WeakMap<TerminalLayoutStore, LayoutMetadata>();
function terminalLayoutMetadata(store: TerminalLayoutStore): LayoutMetadata {
	let value = metadata.get(store);
	if (!value) {
		value = {
			detached: new Set(),
			closed: [],
			initialized: false,
			disposed: false,
			retainers: 0,
		};
		metadata.set(store, value);
	}
	return value;
}

function assertTabCapacity(store: TerminalLayoutStore, extra = 1) {
	if (
		workspaceAreaStores(store).reduce(
			(count, area) => count + area.getState().tabs.length,
			0,
		) +
			extra >
		32
	)
		throw new Error(
			i18n._(
				msg({
					message: "Close a tab before opening more tabs in this workspace.",
				}),
			),
		);
}

export function reconcileTerminalPanes(
	store: TerminalLayoutStore,
	sessions: TerminalSession[],
) {
	const info = terminalLayoutMetadata(store);
	const live = new Set(sessions.map((session) => session.terminalId));
	for (const id of info.detached) if (!live.has(id)) info.detached.delete(id);
	for (const session of sessions) {
		const state = store.getState();
		const existing = findTerminalPane(store, session.terminalId);
		if (
			!existing &&
			!info.initialized &&
			!info.detached.has(session.terminalId)
		) {
			if (
				workspaceAreaStores(store).reduce(
					(count, area) => count + area.getState().tabs.length,
					0,
				) >= 32
			) {
				info.detached.add(session.terminalId);
				continue;
			}
			state.addTab({
				id: session.terminalId,
				panes: [
					{
						id: session.terminalId,
						kind: "terminal",
						data: { terminalId: session.terminalId },
						pinned: true,
					},
				],
				focus: false,
				reuse: false,
			});
		}
	}
	info.initialized = true;
}

function rememberClosedTab(
	store: TerminalLayoutStore,
	tab: Tab<WorkspacePaneData>,
) {
	const info = terminalLayoutMetadata(store);
	info.closed.push({ tab: structuredClone(tab) });
	const records = workspaceAreaStores(store).map((area) =>
		terminalLayoutMetadata(area),
	);
	while (
		records.reduce((count, record) => count + record.closed.length, 0) > 32
	) {
		records
			.filter((record) => record.closed.length)
			.sort(
				(a, b) =>
					(a.closed[0]?.tab.createdAt ?? 0) - (b.closed[0]?.tab.createdAt ?? 0),
			)[0]
			?.closed.shift();
	}
}
function assertBackgroundCapacity(
	store: TerminalLayoutStore,
	ids: string[],
	reattachedId?: string,
) {
	if (
		new Set([
			...workspaceAreaStores(store)
				.flatMap((area) => [...terminalLayoutMetadata(area).detached])
				.filter((id) => id !== reattachedId),
			...ids,
		]).size > 256
	)
		throw new Error(
			i18n._(
				msg({
					message:
						"Too many background terminals. Reattach or end one before closing another view.",
				}),
			),
		);
}
export function detachTerminalPane(store: TerminalLayoutStore, paneId: string) {
	const found = store.getState().getPane(paneId);
	if (!found) return;
	const tab = store.getState().getTab(found.tabId);
	if (tab && Object.keys(tab.panes).length === 1) {
		detachTerminalTab(store, tab.id);
		return;
	}
	const info = terminalLayoutMetadata(store);
	const id = paneTerminalId(found.pane);
	if (id) {
		assertBackgroundCapacity(store, [id]);
		info.detached.add(id);
	}
	store.getState().closePane({ tabId: found.tabId, paneId, intent: "remove" });
}
export function detachTerminalTab(store: TerminalLayoutStore, tabId: string) {
	const tab = store.getState().getTab(tabId);
	if (!tab) return;
	const info = terminalLayoutMetadata(store);
	const ids = Object.values(tab.panes).flatMap((pane) => {
		const id = paneTerminalId(pane);
		return id ? [id] : [];
	});
	assertBackgroundCapacity(store, ids);
	for (const id of ids) info.detached.add(id);
	rememberClosedTab(store, tab);
	store.getState().removeTab(tabId, { intent: "remove" });
}
export function attachTerminalSession(
	store: TerminalLayoutStore,
	session: TerminalSession,
) {
	const state = store.getState();
	const existing = findTerminalPane(store, session.terminalId);
	if (existing && isTerminalPane(existing.pane)) {
		focusWorkspacePane(existing.store, existing.pane.id);
		return;
	}
	for (const area of workspaceAreaStores(store))
		terminalLayoutMetadata(area).detached.delete(session.terminalId);
	assertTabCapacity(store);
	state.addTab({
		id: session.terminalId,
		panes: [
			{
				id: session.terminalId,
				kind: "terminal",
				data: { terminalId: session.terminalId },
				pinned: true,
			},
		],
		focus: true,
		reuse: false,
	});
}
export function switchTerminalSession(
	store: TerminalLayoutStore,
	session: TerminalSession,
	paneId?: string,
) {
	const state = store.getState();
	const active = paneId ? state.getPane(paneId) : state.getActivePane();
	if (paneId && (!active || !isTerminalPane(active.pane))) return false;
	const existing = findTerminalPane(store, session.terminalId);
	if (existing) {
		if (paneId && existing.pane.id !== paneId) return false;
		focusWorkspacePane(existing.store, existing.pane.id);
		return true;
	}
	if (!active || !isTerminalPane(active.pane)) {
		attachTerminalSession(store, session);
		return true;
	}
	const info = terminalLayoutMetadata(store);
	assertBackgroundCapacity(
		store,
		[active.pane.data.terminalId],
		session.terminalId,
	);
	info.detached.add(active.pane.data.terminalId);
	for (const area of workspaceAreaStores(store))
		terminalLayoutMetadata(area).detached.delete(session.terminalId);
	state.setPaneData({
		paneId: active.pane.id,
		data: { terminalId: session.terminalId },
	});
	state.setPaneTitleOverride({
		tabId: active.tabId,
		paneId: active.pane.id,
		titleOverride: undefined,
	});
	if (paneId) focusWorkspacePane(store, paneId);
	return true;
}
export function reopenTerminalTab(
	store: TerminalLayoutStore,
	sessions: TerminalSession[],
) {
	const info = terminalLayoutMetadata(store);
	const live = new Set(sessions.map((session) => session.terminalId));
	while (info.closed.length) {
		const closed = info.closed.pop();
		if (!closed) break;
		const tab = closed.tab;
		const temporary = createWorkspaceStore<WorkspacePaneData>({
			getPaneKey: terminalPaneKey,
		});
		temporary.getState().insertTab({ tab });
		for (const pane of Object.values(tab.panes)) {
			const id = paneTerminalId(pane);
			if (
				id
					? !live.has(id) || !!store.getState().findPaneByKey(id)
					: (pane.kind !== "changes" && pane.kind !== "files") ||
						!!store.getState().getPane(pane.id)
			)
				temporary
					.getState()
					.closePane({ tabId: tab.id, paneId: pane.id, intent: "remove" });
		}
		const restored = temporary.getState().getTab(tab.id);
		if (!restored) continue;
		for (const pane of Object.values(restored.panes)) {
			const id = paneTerminalId(pane);
			if (id) info.detached.delete(id);
		}
		try {
			assertTabCapacity(store);
		} catch (error) {
			info.closed.push(closed);
			throw error;
		}
		store.getState().insertTab({ tab: restored });
		store.getState().setActiveTab(restored.id);
		const active = store.getState().getActivePane();
		if (active) store.getState().focusPane(active.pane.id);
		return true;
	}
	return false;
}
export interface PaneAreaState {
	rightAreaOpen: boolean;
	activityDockHidden: boolean;
	focusedArea: "left" | "right";
}
interface PaneAreas {
	left: TerminalLayoutStore;
	right: TerminalLayoutStore;
	state: StoreApi<PaneAreaState>;
}
const paneAreas = new WeakMap<TerminalLayoutStore, PaneAreas>();
export function workspacePaneAreas(left: TerminalLayoutStore): PaneAreas {
	const known = paneAreas.get(left);
	if (known) return known;
	const right = createTerminalWorkspaceStore();
	const pair: PaneAreas = {
		left,
		right,
		state: createStore<PaneAreaState>(() => ({
			rightAreaOpen: false,
			activityDockHidden: true,
			focusedArea: "left",
		})),
	};
	paneAreas.set(left, pair);
	paneAreas.set(right, pair);
	return pair;
}
export function workspaceAreaStores(
	store: TerminalLayoutStore,
): TerminalLayoutStore[] {
	const areas = paneAreas.get(store);
	return areas ? [areas.left, areas.right] : [store];
}
export function findTerminalPane(
	store: TerminalLayoutStore,
	terminalId: string,
) {
	for (const area of workspaceAreaStores(store)) {
		const found = area.getState().findPaneByKey(terminalId);
		if (found) return { store: area, ...found };
	}
	return null;
}
export function focusWorkspacePane(store: TerminalLayoutStore, paneId: string) {
	const areas = paneAreas.get(store);
	areas?.state.setState({
		focusedArea: areas.right === store ? "right" : "left",
		...(areas.right === store ? { rightAreaOpen: true } : {}),
	});
	store.getState().focusPane(paneId);
}
export function moveWorkspacePane(
	source: TerminalLayoutStore,
	target: TerminalLayoutStore,
	paneId: string,
) {
	if (source === target) return;
	if (
		!workspaceAreaStores(source).includes(target) ||
		terminalLayoutMetadata(source).disposed
	)
		throw new Error(
			i18n._(
				msg({ message: "Pane areas must belong to the same active workspace" }),
			),
		);
	const found = source.getState().getPane(paneId);
	if (!found) return;
	if (
		terminalLayoutMetadata(target).disposed ||
		target.getState().getPane(paneId) ||
		(isTerminalPane(found.pane) &&
			target.getState().findPaneByKey(found.pane.data.terminalId))
	)
		throw new Error(
			i18n._(msg({ message: "The target pane area cannot receive this pane" })),
		);
	if (
		workspaceAreaStores(source).reduce(
			(count, area) => count + area.getState().tabs.length,
			0,
		) +
			(Object.keys(source.getState().getTab(found.tabId)?.panes ?? {}).length >
			1
				? 1
				: 0) >
		32
	)
		throw new Error(
			i18n._(
				msg({
					message: "Close a tab before opening more tabs in this workspace.",
				}),
			),
		);
	const beforeSource = source.getState();
	const beforeTarget = target.getState();
	const flagsBefore = workspacePaneAreas(source).state.getState();
	try {
		transferPaneToNewTab({ source, target, paneId });
		if (!target.getState().getPane(paneId))
			throw new Error(
				i18n._(
					msg({ message: "The target pane area did not receive this pane" }),
				),
			);
		focusWorkspacePane(target, paneId);
	} catch (error) {
		workspacePaneAreas(source).state.setState(flagsBefore, true);
		source.setState(beforeSource, true);
		target.setState(beforeTarget, true);
		throw error;
	}
}
export function backgroundTerminalSessions(
	store: TerminalLayoutStore,
	sessions: TerminalSession[],
) {
	return sessions.filter(
		(session) => !findTerminalPane(store, session.terminalId),
	);
}

export function disposeTerminalWorkspaceStore(store: TerminalLayoutStore) {
	const info = terminalLayoutMetadata(store);
	if (info.disposed) return;
	info.disposed = true;
	for (const partner of workspaceAreaStores(store))
		if (partner !== store) disposeTerminalWorkspaceStore(partner);
	info.closed = [];
}
export function createTerminalWorkspaceStore(): TerminalLayoutStore {
	const store = createWorkspaceStore<WorkspacePaneData>({
		getPaneKey: terminalPaneKey,
	});
	terminalLayoutMetadata(store);
	return store;
}
const stores = new Map<string, TerminalLayoutStore>();
export function terminalWorkspaceStore(key: string): TerminalLayoutStore {
	const store = stores.get(key) ?? createTerminalWorkspaceStore();
	stores.delete(key);
	stores.set(key, store);
	while (stores.size > 8) {
		const oldest = [...stores.entries()].find(
			([, candidate]) => terminalLayoutMetadata(candidate).retainers === 0,
		)?.[0];
		if (!oldest) break;
		const evicted = stores.get(oldest);
		stores.delete(oldest);
		if (evicted) disposeTerminalWorkspaceStore(evicted);
	}
	return store;
}

export function findWorkspacePane(paneId: string) {
	for (const [workspaceKey, store] of stores) {
		for (const area of workspaceAreaStores(store)) {
			const found = area.getState().getPane(paneId);
			if (found) return { workspaceKey, store: area, ...found };
		}
	}
	return null;
}

export function openChangesTab(store: TerminalLayoutStore): string {
	const state = store.getState();
	const existing = state.tabs
		.flatMap((tab) => Object.values(tab.panes))
		.find((pane) => pane.kind === "changes");
	if (existing) {
		state.focusPane(existing.id);
		return existing.id;
	}
	assertTabCapacity(store);
	const id = `changes-${crypto.randomUUID()}`;
	state.addTab({
		id,
		panes: [{ id, kind: "changes", data: { view: "changes" }, pinned: true }],
		reuse: false,
		focus: true,
	});
	return id;
}

export function openFilesTab(store: TerminalLayoutStore): string {
	for (const area of workspaceAreaStores(store)) {
		const existing = area
			.getState()
			.tabs.flatMap((tab) => Object.values(tab.panes))
			.find((pane) => pane.kind === "files");
		if (existing) {
			focusWorkspacePane(area, existing.id);
			return existing.id;
		}
	}
	assertTabCapacity(store);
	const id = `files-${crypto.randomUUID()}`;
	store.getState().addTab({
		id,
		panes: [{ id, kind: "files", data: { view: "files" }, pinned: true }],
		focus: true,
		reuse: false,
	});
	return id;
}
export function retainTerminalWorkspaceStore(store: TerminalLayoutStore) {
	const info = terminalLayoutMetadata(store);
	info.retainers++;
	return () => {
		info.retainers = Math.max(0, info.retainers - 1);
	};
}
