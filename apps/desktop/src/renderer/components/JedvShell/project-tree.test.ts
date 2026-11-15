import { expect, test } from "bun:test";
import { groupProjects, sortWorkspaces } from "./project-tree";
import type { Project, Workspace } from "./types";

const rows = [
	{
		id: "a",
		projectId: "p",
		name: "Alpha",
		branch: "a",
		createdAt: new Date(1),
		updatedAt: new Date(1),
		lastActivityAt: 30,
		tags: ["work"],
	},
	{
		id: "b",
		projectId: "p",
		name: "Beta",
		branch: "b",
		createdAt: new Date(2),
		updatedAt: new Date(2),
		lastActivityAt: 10,
		tags: [],
	},
] as Workspace[];
test("active, created and durable manual order preserve pin priority", () => {
	expect(sortWorkspaces(rows, { sort: "active" }).map((row) => row.id)).toEqual(
		["a", "b"],
	);
	expect(
		sortWorkspaces(rows, { sort: "created" }).map((row) => row.id),
	).toEqual(["b", "a"]);
	expect(
		sortWorkspaces(rows, { sort: "manual", manualOrder: ["b", "a"] }).map(
			(row) => row.id,
		),
	).toEqual(["b", "a"]);
	expect(
		sortWorkspaces(rows, { sort: "created", pinnedIds: new Set(["a"]) }).map(
			(row) => row.id,
		),
	).toEqual(["a", "b"]);
});
test("project grouping uses real tag folder presentation and retains ungrouped rows", () => {
	const projects = [
		{
			id: "p",
			name: "Fixture project",
			tagSettings: [
				{ tag: "work", displayName: "工作组", color: "#3b82f6", tabOrder: 0 },
			],
		},
	] as Project[];
	const grouped = groupProjects(projects, rows, "");
	expect(grouped[0]?.sections[0]).toMatchObject({
		tag: "work",
		name: "工作组",
		workspaces: [{ id: "a" }],
	});
	expect(grouped[0]?.ungrouped.map((row) => row.id)).toEqual(["b"]);
	expect(groupProjects(projects, rows, "no match")).toEqual([]);
});
