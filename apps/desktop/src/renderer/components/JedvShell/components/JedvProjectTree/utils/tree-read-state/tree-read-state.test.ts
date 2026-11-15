import { afterEach, expect, test } from "bun:test";
import {
	MAX_WORKSPACE_READ_RECEIPTS,
	useWorkspaceReadReceipts,
	workspaceReadThrough,
} from "../../../JedvWorkspacesBoard/stores/read-receipts";
import {
	markTreeWorkspaceRead,
	markTreeWorkspaceUnread,
} from "./tree-read-state";

afterEach(() => useWorkspaceReadReceipts.setState({ receipts: new Map() }));
test("manual unread toggles idle and finished workspaces using the bounded original-host receipt cache", () => {
	markTreeWorkspaceUnread("original", "same-id");
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"original",
			"same-id",
		),
	).toBe(-1);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"other",
			"same-id",
		),
	).toBe(0);
	markTreeWorkspaceRead("original", "same-id", 0);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"original",
			"same-id",
		),
	).toBe(0);
	markTreeWorkspaceUnread("original", "same-id");
	markTreeWorkspaceRead("original", "same-id", 100);
	expect(
		workspaceReadThrough(
			useWorkspaceReadReceipts.getState().receipts,
			"original",
			"same-id",
		),
	).toBe(100);
	for (let id = 0; id <= MAX_WORKSPACE_READ_RECEIPTS; id++)
		markTreeWorkspaceUnread("original", String(id));
	expect(useWorkspaceReadReceipts.getState().receipts.size).toBe(
		MAX_WORKSPACE_READ_RECEIPTS,
	);
});
