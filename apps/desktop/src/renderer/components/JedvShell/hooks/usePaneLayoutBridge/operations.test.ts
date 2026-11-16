import { expect, test } from "bun:test";
import {
	createTerminalWorkspaceStore,
	openFilesTab,
	paneTerminalId,
	reconcileTerminalPanes,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { applyPaneLayoutOperation, paneLayoutSnapshot } from "./operations";

const session = (terminalId: string) =>
	({ terminalId, title: terminalId }) as TerminalSession;
function fixture(ids = ["a", "b", "c"]) {
	const store = createTerminalWorkspaceStore(),
		sessions = ids.map(session);
	reconcileTerminalPanes(store, sessions);
	const run = (op: Parameters<typeof applyPaneLayoutOperation>[0]["op"]) =>
		applyPaneLayoutOperation({ store, sessions, op });
	return { store, sessions, run };
}
test("list serializes both areas, split directions, identity and overrides", () => {
	const { store, run } = fixture();
	run({ type: "split", paneId: "a", terminalId: "b", direction: "right" });
	run({ type: "moveToNewTab", paneId: "c", area: "sidebar" });
	store
		.getState()
		.setPaneTitleOverride({ tabId: "a", paneId: "a", titleOverride: "Editor" });
	const snapshot = run({ type: "list" }).layout;
	expect(snapshot.tabs).toHaveLength(1);
	expect(snapshot.tabs[0].layout).toEqual({
		type: "split",
		direction: "row",
		ratio: 0.5,
		first: { type: "pane", paneId: "a" },
		second: { type: "pane", paneId: "b" },
	});
	expect(snapshot.tabs[0].panes.find((p) => p.id === "a")?.title).toBe(
		"Editor",
	);
	expect(snapshot.sidebar?.tabs[0].panes[0].terminalId).toBe("c");
	expect(snapshot.sidebar?.open).toBe(true);
});
test("resize gives second pane its requested share and equalize resets geometry", () => {
	const { store, run } = fixture();
	run({ type: "split", paneId: "a", terminalId: "b", direction: "down" });
	run({ type: "resize", paneId: "b", ratio: 0.3 });
	expect(store.getState().getTab("a")?.layout).toMatchObject({
		direction: "vertical",
		splitPercentage: 70,
	});
	run({ type: "equalize" });
	expect(store.getState().getTab("a")?.layout).toMatchObject({
		splitPercentage: 50,
	});
	expect(() => run({ type: "resize", paneId: "c", ratio: 0.4 })).toThrow(
		"no split",
	);
});
test("moves and swaps preserve resources while explicit close emits only one close", () => {
	const { store, run, sessions } = fixture();
	const areas = workspacePaneAreas(store),
		closed: string[] = [];
	for (const area of [store, areas.right])
		area
			.getState()
			.subscribePaneClose((panes) => closed.push(...panes.map((p) => p.id)));
	run({ type: "moveToNewTab", paneId: "b", area: "sidebar" });
	run({ type: "move", paneId: "c", targetPaneId: "b", direction: "down" });
	run({ type: "swap", paneId: "a", withPaneId: "b" });
	expect(paneTerminalId(store.getState().getPane("b")?.pane)).toBe("b");
	expect(paneTerminalId(areas.right.getState().getPane("a")?.pane)).toBe("a");
	expect(closed).toEqual([]);
	run({ type: "close", paneId: "a", keepTerminal: true });
	reconcileTerminalPanes(store, sessions);
	expect(areas.right.getState().getPane("a")).toBeNull();
	expect(store.getState().getPane("a")).toBeNull();
	expect(closed).toEqual([]);
	run({ type: "close", paneId: "c", keepTerminal: false });
	expect(closed).toEqual(["c"]);
});
test("terminal and pane identifiers cannot cross workspace stores", () => {
	const first = fixture(["a"]),
		second = fixture(["b"]);
	expect(() => first.run({ type: "focus", paneId: "b" })).toThrow(
		"not in this workspace",
	);
	expect(() => first.run({ type: "newTab", terminalId: "b" })).toThrow(
		"not available in this workspace",
	);
	expect(second.store.getState().tabs).toHaveLength(1);
});
test("removed surfaces and unsupported paths reject without changing the layout", () => {
	const { store, run } = fixture();
	const before = paneLayoutSnapshot(store);
	for (const op of [
		{ type: "wakeBrowser", paneId: "a" },
		{
			type: "newTab",
			chat: { sessionId: "chat", terminalId: "a", agentId: "codex" },
		},
		{ type: "open", tool: "browser", url: "https://example.com" },
		{ type: "open", tool: "pages" },
		{ type: "open", tool: "file", path: "/tmp/file" },
		{ type: "open", tool: "changes", path: "file.ts" },
		{ type: "sidebar", open: true, fullScreen: true },
	] as const)
		expect(() => run(op)).toThrow("not supported");
	expect(paneLayoutSnapshot(store)).toEqual(before);
});
test("tab and pane capacity fail before changing layout", () => {
	const { store, sessions, run } = fixture(
		Array.from({ length: 32 }, (_, n) => `t${n}`),
	);
	sessions.push(session("extra"));
	expect(() => run({ type: "newTab", terminalId: "extra" })).toThrow("32 tabs");
	for (let n = 1; n < 8; n++)
		run({
			type: "move",
			paneId: `t${n}`,
			targetPaneId: "t0",
			direction: "right",
		});
	const before = paneLayoutSnapshot(store);
	expect(() =>
		run({ type: "split", paneId: "t0", terminalId: "t8", direction: "right" }),
	).toThrow("eight panes");
	expect(paneLayoutSnapshot(store)).toEqual(before);
});
test("new terminal background tabs do not steal focus and existing sessions are reused", () => {
	const { store, sessions, run } = fixture(["a"]);
	sessions.push(session("background"));
	run({ type: "newTab", terminalId: "background", focus: false });
	expect(store.getState().activeTabId).toBe("a");
	run({ type: "newTab", terminalId: "background", focus: false });
	expect(store.getState().tabs).toHaveLength(2);
	run({
		type: "newTab",
		terminalId: "background",
		area: "sidebar",
		focus: false,
	});
	expect(store.getState().activeTabId).toBe("a");
	expect(workspacePaneAreas(store).state.getState().rightAreaOpen).toBe(false);
});
test("files and changes remain available without reintroducing removed surfaces", () => {
	const { run } = fixture(["a"]);
	const changes = run({ type: "open", tool: "changes" });
	expect(changes.layout.sidebar?.tabs[0].panes[0].kind).toBe("changes");
	const files = run({ type: "open", tool: "files" });
	expect(
		files.layout.sidebar?.tabs
			.flatMap((t) => t.panes)
			.some((p) => p.kind === "files"),
	).toBe(true);
	expect(() =>
		run({ type: "close", paneId: files.paneId ?? "missing" }),
	).toThrow("unsaved changes");
});

test("snapshot reports visible fullscreen only from the shell projection", () => {
	const { store, run } = fixture(["a"]);
	run({ type: "sidebar", open: true });
	expect(paneLayoutSnapshot(store, true).sidebar?.fullScreen).toBe(true);
	run({ type: "sidebar", open: false });
	expect(paneLayoutSnapshot(store, true).sidebar?.fullScreen).toBe(false);
});

test("opening Files reuses its existing pane in the sidebar and background opening preserves selection", () => {
	const { store, run } = fixture(["a", "b"]);
	const fileId = openFilesTab(store);
	run({ type: "open", tool: "files" });
	const right = workspacePaneAreas(store).right;
	expect(store.getState().getPane(fileId)).toBeNull();
	expect(right.getState().getPane(fileId)).not.toBeNull();
	run({ type: "move", paneId: "b", targetPaneId: fileId, direction: "right" });
	right.getState().focusPane("b");
	run({ type: "open", tool: "files", background: true });
	expect(right.getState().getActivePane()?.pane.id).toBe("b");
});

test("reattaching a terminal after switching sessions does not reuse another pane identity", () => {
	const { store, sessions, run } = fixture(["a"]);
	sessions.push({ terminalId: "b" } as TerminalSession);
	store.getState().setPaneData({ paneId: "a", data: { terminalId: "b" } });
	const reopened = run({ type: "newTab", terminalId: "a", focus: false });
	expect(reopened.paneId).not.toBe("a");
	expect(paneTerminalId(store.getState().getPane("a")?.pane)).toBe("b");
	expect(
		paneTerminalId(
			store.getState().getPane(reopened.paneId ?? "missing")?.pane,
		),
	).toBe("a");
	expect(new Set(store.getState().tabs.map((tab) => tab.id)).size).toBe(2);
});
