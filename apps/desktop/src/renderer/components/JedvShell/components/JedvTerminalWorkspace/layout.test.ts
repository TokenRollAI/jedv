import { expect, test } from "bun:test";
import type { TerminalSession } from "../../types";

import {
	attachTerminalSession,
	backgroundTerminalSessions,
	createTerminalWorkspaceStore,
	detachTerminalTab,
	openChangesTab,
	paneTerminalId,
	reconcileTerminalPanes,
	reopenTerminalTab,
	switchTerminalSession,
	terminalWorkspaceStore,
} from "./layout";

const session = (terminalId: string, title = terminalId) =>
	({ terminalId, title }) as TerminalSession;

test("host refresh preserves split membership, titles, and ended scrollback without closing a PTY", () => {
	const store = createTerminalWorkspaceStore();
	reconcileTerminalPanes(store, [session("a"), session("b")]);
	store.getState().movePaneToSplit({
		sourcePaneId: "b",
		targetPaneId: "a",
		position: "right",
	});
	const original = store.getState().getPane("b")?.tabId;
	const a = store.getState().getPane("a");
	if (!a) throw new Error("Terminal pane missing");
	store.getState().setPaneTitleOverride({
		tabId: a.tabId,
		paneId: "a",
		titleOverride: "Preset label",
	});
	const closed: string[] = [];
	const unsubscribe = store
		.getState()
		.subscribePaneClose((panes) => closed.push(...panes.map((p) => p.id)));
	reconcileTerminalPanes(store, [
		session("a", "Agent"),
		session("b", "Tests"),
		session("c", "Server"),
	]);
	expect(store.getState().getPane("b")?.tabId).toBe(original);
	expect(store.getState().tabs).toHaveLength(1);
	expect(
		backgroundTerminalSessions(store, [
			session("a"),
			session("b"),
			session("c"),
		]).map((s) => s.terminalId),
	).toEqual(["c"]);
	expect(store.getState().getPane("a")?.pane.titleOverride).toBe(
		"Preset label",
	);
	reconcileTerminalPanes(store, [
		session("b", "Tests"),
		session("c", "Server"),
	]);
	expect(store.getState().getPane("a")).not.toBeNull();
	expect(store.getState().getPane("b")?.tabId).toBe(original);
	expect(closed).toEqual([]);
	unsubscribe();
});
test("workspace navigation reuses layout only for its exact host and workspace", () => {
	const first = terminalWorkspaceStore("https://a.ts.net:workspace-a");
	reconcileTerminalPanes(first, [session("one")]);
	expect(terminalWorkspaceStore("https://a.ts.net:workspace-a")).toBe(first);
	expect(terminalWorkspaceStore("https://b.ts.net:workspace-a")).not.toBe(
		first,
	);
	expect(terminalWorkspaceStore("https://a.ts.net:workspace-b")).not.toBe(
		first,
	);
});

test("closing a split tab parks its sessions across polling and reopens the same IDs without creating a PTY", () => {
	const store = createTerminalWorkspaceStore();
	const sessions = [session("a"), session("b")];
	reconcileTerminalPanes(store, sessions);
	store.getState().movePaneToSplit({
		sourcePaneId: "b",
		targetPaneId: "a",
		position: "right",
	});
	const tab = store.getState().getPane("a")?.tabId;
	expect(tab).toBeDefined();
	if (!tab) return;
	detachTerminalTab(store, tab);
	reconcileTerminalPanes(store, sessions);
	expect(store.getState().tabs).toHaveLength(0);
	expect(backgroundTerminalSessions(store, sessions)).toHaveLength(2);
	expect(reopenTerminalTab(store, sessions)).toBe(true);
	expect(store.getState().tabs).toHaveLength(1);
	expect(Object.keys(store.getState().tabs[0].panes)).toEqual(["a", "b"]);
	detachTerminalTab(store, tab);
	reconcileTerminalPanes(store, []);
	reconcileTerminalPanes(store, sessions);
	expect(store.getState().tabs).toHaveLength(0);
	attachTerminalSession(store, sessions[1]);
	expect(paneTerminalId(store.getState().getActivePane()?.pane)).toBe("b");
	expect(reopenTerminalTab(store, [])).toBe(false);
	expect(store.getState().tabs).toHaveLength(1);
});

test("Changes opens one dedicated tab and can be reopened without treating it as a terminal", () => {
	const store = createTerminalWorkspaceStore();
	attachTerminalSession(store, session("shell"));
	const id = openChangesTab(store);
	expect(openChangesTab(store)).toBe(id);
	expect(store.getState().tabs).toHaveLength(2);
	expect(paneTerminalId(store.getState().getActivePane()?.pane)).toBeNull();
	detachTerminalTab(store, id);
	expect(reopenTerminalTab(store, [session("shell")])).toBe(true);
	expect(store.getState().getPane(id)?.pane.kind).toBe("changes");
});

test("switching a detached session reuses the current pane and parks its previous PTY", () => {
	const store = createTerminalWorkspaceStore();
	reconcileTerminalPanes(store, [session("current"), session("detached")]);
	detachTerminalTab(store, "detached");
	const paneId = store.getState().getActivePane()?.pane.id;
	switchTerminalSession(store, session("detached"));
	expect(store.getState().tabs).toHaveLength(1);
	expect(store.getState().getActivePane()?.pane.id).toBe(paneId);
	expect(paneTerminalId(store.getState().getActivePane()?.pane)).toBe(
		"detached",
	);
	expect(
		backgroundTerminalSessions(store, [
			session("current"),
			session("detached"),
		]).map((row) => row.terminalId),
	).toEqual(["current"]);
	switchTerminalSession(store, session("detached"));
	expect(store.getState().tabs).toHaveLength(1);
});
