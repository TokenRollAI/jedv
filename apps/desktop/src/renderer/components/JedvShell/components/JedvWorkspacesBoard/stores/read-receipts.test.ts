import { afterEach, expect, test } from "bun:test";
import {
	markWorkspaceRead,
	reconcileWorkspaceReadReceipts,
	useWorkspaceReadReceipts,
	workspaceReadThrough,
} from "./read-receipts";

afterEach(() => useWorkspaceReadReceipts.setState({ receipts: new Map() }));
test("read watermarks survive subscriptions, isolate hosts, and reclaim deleted workspaces", () => {
	markWorkspaceRead("host-a", "workspace", 100);
	const unsubscribe = useWorkspaceReadReceipts.subscribe(() => {});
	unsubscribe();
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-a",
			"workspace",
		),
	).toBe(100);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-b",
			"workspace",
		),
	).toBe(0);
	markWorkspaceRead("host-a", "workspace");
	markWorkspaceRead("host-a", "workspace", 90);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-a",
			"workspace",
		),
	).toBe(100);
	markWorkspaceRead("host-b", "workspace", 50);
	reconcileWorkspaceReadReceipts("host-a", []);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-a",
			"workspace",
		),
	).toBe(0);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-b",
			"workspace",
		),
	).toBe(50);
});
test("read receipts keep at most 256 host/workspace entries", () => {
	for (let i = 0; i < 257; i++) markWorkspaceRead("host-a", String(i), i + 1);
	expect(useWorkspaceReadReceipts.getState().receipts.size).toBe(256);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-a",
			"0",
		),
	).toBe(0);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"host-a",
			"256",
		),
	).toBe(257);
});
