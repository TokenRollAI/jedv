import { afterEach, expect, test } from "bun:test";
import type {
	WorkspaceReadReceipt,
	WorkspaceReadReceiptChange,
} from "shared/workspace-read-receipts";
import {
	markWorkspaceRead,
	markWorkspaceUnread,
	readReceiptSync,
	useWorkspaceReadReceipts,
	workspaceReadThrough,
} from "../../components/JedvWorkspacesBoard/stores/read-receipts";
import { createReadReceiptSync } from "./sync";

function clear() {
	for (const change of readReceiptSync.pending())
		readReceiptSync.acknowledge(change);
	useWorkspaceReadReceipts.setState({ receipts: new Map(), syncError: null });
}
afterEach(clear);
test("authoritative hydration merges pending event watermarks, single cross-window changes and failed manual unread retry", async () => {
	clear();
	let resolve!: (records: WorkspaceReadReceipt[]) => void;
	const load = new Promise<WorkspaceReadReceipt[]>((done) => {
		resolve = done;
	});
	let change!: (event: WorkspaceReadReceiptChange) => void;
	const writes: unknown[] = [];
	let failed = false;
	const service = createReadReceiptSync(
		{
			get: () => load,
			set: async (action) => {
				writes.push(action);
				if (failed) throw new Error("disk full");
				return {
					hostId: "local",
					workspaceId: action.workspaceId,
					readThrough: action.readThrough,
				};
			},
			subscribe: (listener) => {
				change = listener;
				return () => {};
			},
		},
		() => {},
	);
	const starting = service.start();
	markWorkspaceRead("http://127.0.0.1:5000", "a", 100);
	change({
		hostId: "https://remote.ts.net",
		workspaceId: "b",
		readThrough: -1,
	});
	resolve([{ hostId: "local", workspaceId: "a", readThrough: 80 }]);
	await starting;
	expect(writes).toEqual([
		{ hostUrl: "http://127.0.0.1:5000", workspaceId: "a", readThrough: 100 },
	]);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"http://127.0.0.1:9000",
			"a",
		),
	).toBe(100);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"https://remote.ts.net",
			"b",
		),
	).toBe(-1);
	failed = true;
	markWorkspaceUnread("http://127.0.0.1:9000", "a");
	await service.flush();
	expect(useWorkspaceReadReceipts.getState().syncError?.message).toBe(
		"disk full",
	);
	expect(readReceiptSync.pending()).toHaveLength(1);
	failed = false;
	await service.retry();
	expect(readReceiptSync.pending()).toHaveLength(0);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"http://127.0.0.1:5000",
			"a",
		),
	).toBe(-1);
	expect(useWorkspaceReadReceipts.getState().syncError).toBeNull();
	change({
		hostId: "https://remote.ts.net",
		workspaceId: "other",
		readThrough: 120,
		evicted: { hostId: "https://remote.ts.net", workspaceId: "b" },
	});
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"https://remote.ts.net",
			"b",
		),
	).toBe(0);
	service.dispose();
});
