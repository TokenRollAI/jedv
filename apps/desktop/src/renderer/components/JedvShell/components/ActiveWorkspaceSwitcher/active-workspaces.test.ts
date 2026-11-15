import { expect, test } from "bun:test";
import type { Workspace } from "../../types";
import { type ActiveBinding, activeWorkspaceItems } from "./active-workspaces";

test("switcher uses highest live agent status, excludes deleted workspaces and ended bindings", () => {
	const rows = [
		{ id: "one", archivedAt: null },
		{ id: "two", archivedAt: null },
		{ id: "deleted", archivedAt: 1 },
		{ id: "idle", archivedAt: null },
	] as Workspace[];
	const bindings = [
		{ workspaceId: "one", lastEventType: "Start", endedAt: null },
		{ workspaceId: "one", lastEventType: "PermissionRequest", endedAt: null },
		{ workspaceId: "one", lastEventType: "Failed", endedAt: null },
		{ workspaceId: "two", lastEventType: "Stop", endedAt: null },
		{ workspaceId: "two", lastEventType: "PermissionRequest", endedAt: 1 },
		{ workspaceId: "deleted", lastEventType: "Start", endedAt: null },
		{ workspaceId: "idle", lastEventType: "Attached", endedAt: null },
	] as ActiveBinding[];
	expect(
		activeWorkspaceItems(rows, bindings).map((row) => [
			row.workspace.id,
			row.status,
		]),
	).toEqual([
		["one", "permission"],
		["two", "review"],
	]);
});
