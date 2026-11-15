import { expect, test } from "bun:test";
import {
	encodeWorkspaceLayout,
	type JedvWorkspaceLayout,
} from "shared/jedv-workspace-layout";
import {
	createTerminalWorkspaceStore,
	detachTerminalTab,
	moveWorkspacePane,
	openChangesTab,
	openFilesTab,
	reconcileTerminalPanes,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { createLayoutPersistenceAdapter } from "./adapter";

const session = (terminalId: string) =>
	({ terminalId, title: terminalId }) as TerminalSession;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function splitFixture() {
	const store = createTerminalWorkspaceStore();
	reconcileTerminalPanes(store, [
		session("a"),
		session("b"),
		session("parked"),
	]);
	store.getState().movePaneToSplit({
		sourcePaneId: "b",
		targetPaneId: "a",
		position: "right",
	});
	detachTerminalTab(store, "parked");
	return encodeWorkspaceLayout(store.getState(), ["parked"]);
}
test("slow restore shares one load, waits for actual sessions and preserves split plus detached IDs through empty polls", async () => {
	const store = createTerminalWorkspaceStore();
	const disk = splitFixture();
	const get = deferred<JedvWorkspaceLayout | null>();
	let loads = 0;
	const writes: JedvWorkspaceLayout[] = [];
	const adapter = createLayoutPersistenceAdapter({
		store,
		reconcile: reconcileTerminalPanes,
		client: {
			get: () => {
				loads++;
				return get.promise;
			},
			set: async (layout) => {
				writes.push(layout);
			},
		},
	});
	adapter.update([], false);
	const first = adapter.start();
	const second = adapter.start();
	expect(loads).toBe(1);
	get.resolve(disk);
	await Promise.all([first, second]);
	expect(adapter.getState().ready).toBe(false);
	expect(store.getState().tabs).toHaveLength(0);
	expect(writes).toHaveLength(0);
	adapter.update([session("a"), session("b"), session("parked")], true);
	expect(adapter.getState().ready).toBe(true);
	expect(store.getState().tabs).toHaveLength(1);
	expect(store.getState().findPaneByKey("parked")).toBeNull();
	expect(store.getState().tabs[0]?.layout).toEqual(disk.tabs[0]?.layout);
	adapter.update([], false);
	adapter.update([session("a"), session("b"), session("parked")], true);
	await adapter.flush();
	expect(store.getState().findPaneByKey("parked")).toBeNull();
	expect(encodeWorkspaceLayout(store.getState(), ["parked"])).toEqual(disk);
});
test("first disk restore removes stale terminal panes with existing panes reducer and retains saved file focus", async () => {
	const original = createTerminalWorkspaceStore();
	reconcileTerminalPanes(original, [session("stale")]);
	const files = openFilesTab(original);
	const disk = encodeWorkspaceLayout(original.getState(), []);
	const store = createTerminalWorkspaceStore();
	const writes: JedvWorkspaceLayout[] = [];
	const adapter = createLayoutPersistenceAdapter({
		store,
		reconcile: reconcileTerminalPanes,
		client: {
			get: async () => disk,
			set: async (layout) => {
				writes.push(layout);
			},
		},
	});
	adapter.update([], true);
	await adapter.start();
	await adapter.flush();
	expect(store.getState().findPaneByKey("stale")).toBeNull();
	expect(store.getState().tabs).toHaveLength(1);
	expect(store.getState().tabs[0]?.layout).toEqual({
		type: "pane",
		paneId: files,
	});
	expect(store.getState().tabs[0]?.activePaneId).toBe(files);
	expect(writes.at(-1)?.detachedTerminalIds).toEqual([]);
});
test("user edits while loading win and writes serialize the latest change with retry after failure", async () => {
	const store = createTerminalWorkspaceStore();
	const get = deferred<JedvWorkspaceLayout | null>();
	const firstWrite = deferred<void>();
	const writes: JedvWorkspaceLayout[] = [];
	let fail = false;
	const adapter = createLayoutPersistenceAdapter({
		store,
		reconcile: reconcileTerminalPanes,
		client: {
			get: () => get.promise,
			set: async (layout) => {
				writes.push(layout);
				if (writes.length === 1) await firstWrite.promise;
				if (fail) throw new Error("disk full");
			},
		},
	});
	adapter.update([], true);
	const load = adapter.start();
	openChangesTab(store);
	const current = store.getState().tabs[0]?.id;
	get.resolve(splitFixture());
	await load;
	expect(store.getState().tabs[0]?.id).toBe(current);
	expect(store.getState().findPaneByKey("a")).toBeNull();
	const files = openFilesTab(store);
	firstWrite.resolve();
	await adapter.flush();
	expect(writes.at(-1)?.activeTabId).toBe(files);
	fail = true;
	store.getState().setActiveTab(current ?? null);
	await adapter.flush();
	expect(adapter.getState().error?.message).toBe("disk full");
	expect(adapter.getState().ready).toBe(true);
	fail = false;
	await adapter.retry();
	expect(adapter.getState().status).toBe("ready");
});

test("paired layout persists a hidden right area without detaching or duplicating its terminal", async () => {
	const source = createTerminalWorkspaceStore();
	const pair = workspacePaneAreas(source);
	reconcileTerminalPanes(source, [session("right-pty")]);
	moveWorkspacePane(source, pair.right, "right-pty");
	pair.state.setState({ rightAreaOpen: false, activityDockHidden: true });
	const disk = {
		...encodeWorkspaceLayout(source.getState(), []),
		rightArea: {
			version: 1 as const,
			tabs: pair.right.getState().tabs,
			activeTabId: pair.right.getState().activeTabId,
		},
		rightAreaOpen: false,
	};
	const store = createTerminalWorkspaceStore();
	const writes: JedvWorkspaceLayout[] = [];
	const adapter = createLayoutPersistenceAdapter({
		store,
		reconcile: reconcileTerminalPanes,
		client: {
			get: async () => disk,
			set: async (layout) => {
				writes.push(layout);
			},
		},
	});
	adapter.update([session("right-pty")], true);
	await adapter.start();
	await adapter.flush();
	expect(store.getState().tabs).toHaveLength(0);
	expect(
		workspacePaneAreas(store).right.getState().findPaneByKey("right-pty")?.pane
			.id,
	).toBe("right-pty");
	expect(workspacePaneAreas(store).state.getState().rightAreaOpen).toBe(false);
	expect(writes.at(-1)?.detachedTerminalIds ?? []).toEqual([]);
});
