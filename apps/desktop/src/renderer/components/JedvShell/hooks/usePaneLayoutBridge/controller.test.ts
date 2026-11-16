import { expect, test } from "bun:test";
import type {
	PaneLayoutRendererRequest,
	PaneLayoutReply,
} from "main/lib/pane-layout/pane-layout-requests";
import {
	createTerminalWorkspaceStore,
	reconcileTerminalPanes,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { createPaneLayoutController } from "./controller";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const request = (
	id: string,
	op: PaneLayoutRendererRequest["op"] = { type: "list" },
): PaneLayoutRendererRequest => ({
	requestId: id,
	workspaceId: "local-workspace",
	targetWebContentsId: 1,
	targetSubscriptionId: "subscriber",
	expiresAt: 1000,
	op,
});
function fixture() {
	const store = createTerminalWorkspaceStore();
	const sessions = [
		{ terminalId: "a" },
		{ terminalId: "b" },
	] as TerminalSession[];
	reconcileTerminalPanes(store, sessions);
	const replies: PaneLayoutReply[] = [];
	let releases = 0,
		writes = 0,
		current = true,
		now = 0;
	const loaded = {
		store,
		sessions,
		release: () => {
			releases++;
		},
		flush: async () => {
			writes++;
		},
	};
	const input = {
		load: async (_workspaceId: string) => loaded,
		focusWorkspace: async (_workspaceId: string) => {},
		respond: async (reply: PaneLayoutReply) => {
			replies.push(reply);
		},
		isCurrent: () => current,
		now: () => now,
	};
	return {
		store,
		loaded,
		replies,
		input,
		releases: () => releases,
		writes: () => writes,
		changeHost: () => {
			current = false;
		},
		expire: () => {
			now = 1000;
		},
	};
}
test("serial requests are bounded and duplicates do not apply mutations twice", async () => {
	const f = fixture(),
		gate = deferred<typeof f.loaded>();
	const loads: string[] = [];
	const controller = createPaneLayoutController({
		...f.input,
		load: async (id) => {
			loads.push(id);
			return gate.promise;
		},
	});
	const first = controller.enqueue(
		request("first", { type: "close", paneId: "a", keepTerminal: true }),
	);
	void controller.enqueue(
		request("first", { type: "close", paneId: "a", keepTerminal: true }),
	);
	const rest = Array.from({ length: 31 }, (_, n) =>
		controller.enqueue(request(`queued-${n}`)),
	);
	await controller.enqueue(request("overflow"));
	expect(f.replies[0].error?.message).toContain("Too many");
	expect(loads).toHaveLength(1);
	gate.resolve(f.loaded);
	await first;
	await Promise.all(rest);
	expect(f.writes()).toBe(1);
	await controller.enqueue(
		request("first", { type: "close", paneId: "a", keepTerminal: true }),
	);
	expect(f.writes()).toBe(1);
	expect(f.replies.at(-1)?.result).toBeDefined();
	controller.dispose();
});
test("connection changes during loading fence old mutations and release stores", async () => {
	const f = fixture(),
		gate = deferred<typeof f.loaded>();
	const controller = createPaneLayoutController({
		...f.input,
		load: () => gate.promise,
	});
	const done = controller.enqueue(
		request("old", { type: "close", paneId: "a" }),
	);
	await Promise.resolve();
	f.changeHost();
	gate.resolve(f.loaded);
	await done;
	expect(f.store.getState().getPane("a")).not.toBeNull();
	expect(f.writes()).toBe(0);
	expect(f.releases()).toBe(1);
	expect(f.replies[0].error?.message).toContain("connection changed");
});
test("expired requests never mutate and disposal fences queued work", async () => {
	const f = fixture();
	f.expire();
	const controller = createPaneLayoutController(f.input);
	await controller.enqueue(request("expired", { type: "close", paneId: "a" }));
	expect(f.replies[0].error?.message).toContain("expired");
	expect(f.store.getState().getPane("a")).not.toBeNull();
	controller.dispose();
	await controller.enqueue(request("disposed"));
	expect(f.replies).toHaveLength(1);
});
test("focus is guarded before mutation and persistence failures are not reported as success", async () => {
	const f = fixture();
	const rejected = createPaneLayoutController({
		...f.input,
		focusWorkspace: async () => {
			throw new Error("Unsaved files");
		},
	});
	const before = f.store.getState().activeTabId;
	await rejected.enqueue(request("focus", { type: "focus", paneId: "b" }));
	expect(f.store.getState().activeTabId).toBe(before);
	expect(f.replies[0].error?.message).toBe("Unsaved files");
	const failedSave = createPaneLayoutController({
		...f.input,
		load: async () => ({
			...f.loaded,
			flush: async () => {
				throw new Error("disk full");
			},
		}),
	});
	await failedSave.enqueue(request("save", { type: "sidebar", open: true }));
	expect(f.replies.at(-1)?.error?.message).toBe("disk full");
	expect(f.replies.at(-1)?.result).toBeUndefined();
});

test("list projects the visible sidebar fullscreen state from the shell", async () => {
	const f = fixture();
	workspacePaneAreas(f.store).state.setState({ rightAreaOpen: true });
	const controller = createPaneLayoutController({
		...f.input,
		getSidebarFullScreen: (id) => id === "local-workspace",
	});
	await controller.enqueue(request("fullscreen"));
	expect(f.replies[0].result?.layout.sidebar?.fullScreen).toBe(true);
	expect(f.writes()).toBe(0);
});
