import { expect, test } from "bun:test";
import {
	createTerminalWorkspaceStore,
	reconcileTerminalPanes,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { createResumedTerminalPaneController } from "./controller";

const session = (terminalId: string) => ({ terminalId }) as TerminalSession;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function clock() {
	let now = 0,
		next = 0;
	const timers = new Map<number, { at: number; callback(): void }>();
	return {
		now: () => now,
		schedule(callback: () => void, delay: number) {
			const id = ++next;
			timers.set(id, { at: now + delay, callback });
			return () => {
				timers.delete(id);
			};
		},
		async advance(ms = 0) {
			now += ms;
			for (let round = 0; round < 100; round++) {
				const due = [...timers.entries()].filter(
					([, timer]) => timer.at <= now,
				);
				for (const [id, timer] of due) {
					timers.delete(id);
					timer.callback();
				}
				await Promise.resolve();
			}
		},
		size: () => timers.size,
	};
}
const ready = (sessions: TerminalSession[]) => ({
	sessions,
	connected: true,
	sessionsReady: true,
	layoutReady: true,
});
function storeFor(ids = ["old"]) {
	const store = createTerminalWorkspaceStore();
	reconcileTerminalPanes(store, ids.map(session));
	return store;
}
test("missed events reconcile only opened missing terminals with concurrency two and bounded rounds", async () => {
	const store = storeFor(Array.from({ length: 12 }, (_, i) => `old-${i}`)),
		time = clock();
	const queried: string[] = [];
	let active = 0,
		maximum = 0;
	const service = createResumedTerminalPaneController({
		store,
		workspaceId: "workspace",
		isCurrent: () => true,
		...time,
		lookup: async (id) => {
			queried.push(id);
			active++;
			maximum = Math.max(maximum, active);
			await Promise.resolve();
			active--;
			return null;
		},
	});
	service.update(ready([session("background-new")]));
	await time.advance();
	expect(queried).toHaveLength(8);
	expect(maximum).toBe(2);
	await time.advance(1000);
	expect(queried).toHaveLength(12);
	expect(queried).not.toContain("background-new");
	service.dispose();
	expect(time.size()).toBe(0);
});
test("resumed is only a scoped trigger and strict null cannot replace a pane", async () => {
	const store = storeFor(),
		time = clock(),
		queried: string[] = [];
	const service = createResumedTerminalPaneController({
		store,
		workspaceId: "workspace",
		isCurrent: () => true,
		...time,
		lookup: async (id) => {
			queried.push(id);
			return null;
		},
	});
	service.update(ready([session("old"), session("new")]));
	service.resumed("another-workspace", "old");
	service.resumed("workspace", "background");
	await time.advance();
	expect(queried).toEqual([]);
	service.resumed("workspace", "old");
	service.resumed("workspace", "old");
	await time.advance();
	expect(queried).toEqual(["old"]);
	expect(store.getState().getPane("old")?.pane.data).toEqual({
		terminalId: "old",
	});
	service.dispose();
});
test("successor is shown only after an authoritative list includes it", async () => {
	const store = storeFor(),
		time = clock();
	let calls = 0;
	const service = createResumedTerminalPaneController({
		store,
		workspaceId: "workspace",
		isCurrent: () => true,
		...time,
		lookup: async () => {
			calls++;
			return { terminalId: "new" };
		},
	});
	service.update(ready([]));
	await time.advance();
	expect(store.getState().getPane("old")?.pane.data).toEqual({
		terminalId: "old",
	});
	service.update(ready([session("new")]));
	await time.advance(1000);
	expect(store.getState().getPane("old")?.pane.data).toEqual({
		terminalId: "new",
	});
	expect(calls).toBe(2);
	service.dispose();
});
test("host/workspace context changes fence late replies and disable aborts in-flight lookups", async () => {
	const store = storeFor(),
		time = clock(),
		gate = deferred<{ terminalId: string }>();
	let sameContext = true,
		signal: AbortSignal | undefined;
	const service = createResumedTerminalPaneController({
		store,
		workspaceId: "workspace",
		isCurrent: () => sameContext,
		...time,
		lookup: async (_id, nextSignal) => {
			signal = nextSignal;
			return gate.promise;
		},
	});
	service.update(ready([session("new")]));
	await time.advance();
	sameContext = false;
	service.update({ ...ready([]), connected: false });
	expect(signal?.aborted).toBe(true);
	gate.resolve({ terminalId: "new" });
	await time.advance();
	expect(store.getState().getPane("old")?.pane.data).toEqual({
		terminalId: "old",
	});
	expect(time.size()).toBe(0);
	service.dispose();
});
test("readiness gates, disconnect and reconnect retain retry safety without real timeout waits", async () => {
	const store = storeFor(),
		time = clock();
	let calls = 0;
	const service = createResumedTerminalPaneController({
		store,
		workspaceId: "workspace",
		isCurrent: () => true,
		...time,
		lookup: async () => {
			calls++;
			return null;
		},
	});
	service.update({ ...ready([]), layoutReady: false });
	await time.advance();
	expect(calls).toBe(0);
	service.update(ready([]));
	await time.advance();
	expect(calls).toBe(1);
	await time.advance(1000);
	expect(calls).toBe(1);
	service.reconnected();
	await time.advance();
	expect(calls).toBe(2);
	service.update({ ...ready([]), sessionsReady: false });
	await time.advance(60_000);
	expect(calls).toBe(2);
	service.update(ready([]));
	await time.advance();
	expect(calls).toBe(3);
	service.dispose();
	await time.advance(60_000);
	expect(calls).toBe(3);
});
test("user changes a pane while lookup is pending so stale reply does not apply", async () => {
	const store = storeFor(),
		time = clock(),
		gate = deferred<{ terminalId: string }>();
	const service = createResumedTerminalPaneController({
		store,
		workspaceId: "workspace",
		isCurrent: () => true,
		...time,
		lookup: () => gate.promise,
	});
	service.update(ready([session("new"), session("user-choice")]));
	await time.advance();
	store
		.getState()
		.setPaneData({ paneId: "old", data: { terminalId: "user-choice" } });
	gate.resolve({ terminalId: "new" });
	await time.advance();
	expect(store.getState().getPane("old")?.pane.data).toEqual({
		terminalId: "user-choice",
	});
	service.dispose();
});
