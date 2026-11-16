import { expect, test } from "bun:test";
import {
	createTerminalWorkspaceStore,
	moveWorkspacePane,
	reconcileTerminalPanes,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { captureTerminalPanes, rebindVerifiedTerminal } from "./rebind";

const session = (terminalId: string) => ({ terminalId }) as TerminalSession;
function fixture() {
	const store = createTerminalWorkspaceStore();
	reconcileTerminalPanes(store, [session("old"), session("neighbor")]);
	store.getState().movePaneToSplit({
		sourcePaneId: "neighbor",
		targetPaneId: "old",
		position: "right",
	});
	store.getState().setPaneTitleOverride({
		tabId: "old",
		paneId: "old",
		titleOverride: "My agent",
	});
	store
		.getState()
		.setTabTitleOverride({ tabId: "old", titleOverride: "My split" });
	store.getState().focusPane("old");
	return store;
}
test("verified successor replaces only terminal data and preserves pane/tab identity, titles, split and focus", () => {
	const store = fixture(),
		areas = workspacePaneAreas(store);
	const before = store.getState(),
		flags = areas.state.getState(),
		captured = captureTerminalPanes(store);
	const originalPane = before.getPane("old")?.pane;
	if (!originalPane) throw new Error("Expected the original fixture pane");
	const closed: string[] = [];
	store
		.getState()
		.subscribePaneClose((panes) => closed.push(...panes.map((p) => p.id)));
	const result = rebindVerifiedTerminal({
		store,
		previousTerminalId: "old",
		terminalId: "new",
		captured,
	});
	expect(result?.paneId).toBe("old");
	expect(store.getState().getPane("old")?.pane).toEqual({
		...originalPane,
		data: { terminalId: "new" },
	});
	expect(store.getState().tabs[0].id).toBe(before.tabs[0].id);
	expect(store.getState().tabs[0].titleOverride).toBe("My split");
	expect(store.getState().tabs[0].layout).toBe(before.tabs[0].layout);
	expect(store.getState().activeTabId).toBe(before.activeTabId);
	expect(store.getState().focusRequest).toBe(before.focusRequest);
	expect(areas.state.getState()).toBe(flags);
	expect(closed).toEqual([]);
});
test("a hidden right-area pane follows without showing it and a background terminal stays background", () => {
	const store = fixture(),
		areas = workspacePaneAreas(store);
	moveWorkspacePane(store, areas.right, "old");
	areas.state.setState({ rightAreaOpen: false, focusedArea: "left" });
	const before = areas.right.getState();
	rebindVerifiedTerminal({
		store,
		previousTerminalId: "old",
		terminalId: "new",
		captured: captureTerminalPanes(store),
	});
	expect(areas.right.getState().tabs[0].id).toBe(before.tabs[0].id);
	expect(areas.right.getState().getPane("old")?.pane.data).toEqual({
		terminalId: "new",
	});
	expect(areas.state.getState().rightAreaOpen).toBe(false);
	expect(
		rebindVerifiedTerminal({
			store,
			previousTerminalId: "background",
			terminalId: "background-new",
			captured: captureTerminalPanes(store),
		}),
	).toBeNull();
	expect(
		captureTerminalPanes(store).some(
			(item) => item.pane.data.terminalId === "background-new",
		),
	).toBe(false);
});
test("a successor that the user already focused wins deduplication without any resource close", () => {
	const store = fixture(),
		areas = workspacePaneAreas(store);
	const captured = captureTerminalPanes(store);
	areas.right.getState().addTab({
		id: "new-tab",
		panes: [
			{
				id: "new-pane",
				kind: "terminal",
				data: { terminalId: "new" },
				titleOverride: "Opened intentionally",
			},
		],
	});
	areas.state.setState({ rightAreaOpen: true, focusedArea: "right" });
	const closed: string[] = [];
	for (const area of [store, areas.right])
		area
			.getState()
			.subscribePaneClose((panes) => closed.push(...panes.map((p) => p.id)));
	const result = rebindVerifiedTerminal({
		store,
		previousTerminalId: "old",
		terminalId: "new",
		captured,
	});
	expect(result?.paneId).toBe("new-pane");
	expect(result?.removedPaneIds).toEqual(["old"]);
	expect(areas.right.getState().getActivePane()?.pane.titleOverride).toBe(
		"Opened intentionally",
	);
	expect(areas.state.getState().focusedArea).toBe("right");
	expect(
		captureTerminalPanes(store).filter(
			(item) => item.pane.data.terminalId === "new",
		),
	).toHaveLength(1);
	expect(closed).toEqual([]);
});
test("unfocused duplicate successor is removed while the focused old pane keeps its identity", () => {
	const store = fixture(),
		areas = workspacePaneAreas(store);
	areas.right.getState().addTab({
		id: "extra",
		panes: [{ id: "duplicate", kind: "terminal", data: { terminalId: "new" } }],
	});
	const before = store.getState();
	const result = rebindVerifiedTerminal({
		store,
		previousTerminalId: "old",
		terminalId: "new",
		captured: captureTerminalPanes(store),
	});
	expect(result?.paneId).toBe("old");
	expect(result?.removedPaneIds).toEqual(["duplicate"]);
	expect(store.getState().tabs[0].layout).toBe(before.tabs[0].layout);
	expect(store.getState().focusRequest).toBe(before.focusRequest);
	expect(areas.right.getState().tabs).toHaveLength(0);
});
test("late results cannot overwrite switched, edited, moved or removed pane snapshots", () => {
	for (const change of ["switch", "title", "move", "remove"] as const) {
		const store = fixture(),
			captured = captureTerminalPanes(store);
		if (change === "switch")
			store
				.getState()
				.setPaneData({ paneId: "old", data: { terminalId: "user-choice" } });
		if (change === "title")
			store.getState().setPaneTitleOverride({
				tabId: "old",
				paneId: "old",
				titleOverride: "Edited during lookup",
			});
		if (change === "move")
			moveWorkspacePane(store, workspacePaneAreas(store).right, "old");
		if (change === "remove")
			store
				.getState()
				.closePane({ tabId: "old", paneId: "old", intent: "remove" });
		expect(
			rebindVerifiedTerminal({
				store,
				previousTerminalId: "old",
				terminalId: "new",
				captured,
			}),
		).toBeNull();
		expect(
			captureTerminalPanes(store).some(
				(item) => item.pane.data.terminalId === "new",
			),
		).toBe(false);
	}
});
