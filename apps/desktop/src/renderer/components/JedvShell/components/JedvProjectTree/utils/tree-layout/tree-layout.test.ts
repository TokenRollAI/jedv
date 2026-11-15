import { expect, test } from "bun:test";
import type { Workspace } from "../../../../types";
import {
	matchesTreeFilter,
	projectTreeLanes,
	sameTreeLaneOrder,
	treeGroups,
} from "./tree-layout";

test("grouped manual scope retains every live ID once, including pinned multi-tag workspaces", () => {
	const rows = [
		{ id: "a", tags: ["one", "two"], archivedAt: null },
		{ id: "b", tags: ["one"], archivedAt: null },
		{ id: "c", tags: ["two"], archivedAt: null },
		{ id: "d", tags: [], archivedAt: null },
		{ id: "deleted", tags: [], archivedAt: 1 },
	] as unknown as Workspace[];
	const groups = treeGroups(
		rows.filter((row) => row.archivedAt == null),
		[
			{ tag: "one", displayName: "中文组", color: null, tabOrder: 0 },
			{ tag: "two", displayName: "Second", color: null, tabOrder: 1 },
		],
	);
	const lanes = projectTreeLanes(rows, groups, {
		sort: "manual",
		manualOrder: ["d", "c", "b", "a"],
		pinnedIds: new Set(["a"]),
	});
	expect(lanes.flatMap((lane) => lane.workspaces.map((row) => row.id))).toEqual(
		["a", "d", "b", "c"],
	);
	expect(
		new Set(lanes.flatMap((lane) => lane.workspaces.map((row) => row.id))).size,
	).toBe(4);
	expect(sameTreeLaneOrder(lanes, ["a", "d", "c", "b"])).toBe(false);
	expect(sameTreeLaneOrder(lanes, ["a", "d", "b"])).toBe(false);
	expect(
		matchesTreeFilter(
			"Fixture",
			{ ...rows[1], name: "work", branch: "feature" } as Workspace,
			"中文组",
			groups,
		),
	).toBe(true);
});
