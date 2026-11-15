import { expect, mock, test } from "bun:test";
import type { LocalClient } from "../../../../local-client";
import {
	type ExternalRepo,
	importExternalWorktrees,
} from "./importExternalWorktrees";

const repos = [
	{
		repoPath: "/fixture/repo",
		name: "Fixture",
		worktrees: [
			{ path: "/fixture/first", branch: "first", source: "conductor" },
			{ path: "/fixture/second", branch: "second", source: "t3code" },
		],
	},
] as ExternalRepo[];
const messages = {
	repoUnavailable: "Repository is no longer available",
	multipleProjects: "Multiple matching projects",
	importFailed: "Import failed",
};
test("only explicitly selected worktrees are imported and setup is never run", async () => {
	const create = mock(async (_input: unknown) => ({
		workspace: { id: "imported-1" },
	}));
	const add = mock(async () => ({ projectId: "project-1" }));
	const client = {
		project: {
			findByPath: { query: async () => ({ candidates: [] }) },
			create: { mutate: add },
		},
		workspaces: { create: { mutate: create } },
	} as unknown as LocalClient;
	const none = await importExternalWorktrees({
		client,
		repos,
		selectedPaths: new Set(),
		idForPath: () => "fixture-id",
		messages,
	});
	expect(none.workspaceIds).toEqual([]);
	expect(add).not.toHaveBeenCalled();
	await importExternalWorktrees({
		client,
		repos,
		selectedPaths: new Set(["/fixture/second"]),
		idForPath: () => "fixture-id",
		messages,
	});
	expect(create).toHaveBeenCalledTimes(1);
	expect(create.mock.calls[0]?.[0]).toEqual({
		id: "fixture-id",
		projectId: "project-1",
		checkout: "worktree",
		branch: "second",
		worktreePath: "/fixture/second",
		skipBranchPrefix: true,
		runSetup: false,
		trackSetupCompletion: true,
	});
});
test("a partial import retains its existing project and successful workspace without rollback or overwrite", async () => {
	const create = mock(async (input: { worktreePath: string }) => {
		if (input.worktreePath.endsWith("second"))
			throw new Error("Permission denied");
		return { workspace: { id: "first-workspace" } };
	});
	const add = mock(async () => ({ projectId: "should-not-create" }));
	const client = {
		project: {
			findByPath: {
				query: async () => ({
					candidates: [{ id: "existing-project", name: "Custom name" }],
				}),
			},
			create: { mutate: add },
		},
		workspaces: { create: { mutate: create } },
	} as unknown as LocalClient;
	const result = await importExternalWorktrees({
		client,
		repos,
		selectedPaths: new Set(repos[0]?.worktrees.map((row) => row.path)),
		idForPath: (path) => path,
		messages,
	});
	expect(add).not.toHaveBeenCalled();
	expect(result.projectIds).toEqual(["existing-project"]);
	expect(result.workspaceIds).toEqual(["first-workspace"]);
	expect(result.results["/fixture/first"]).toEqual({ state: "done" });
	expect(result.results["/fixture/second"]).toEqual({
		state: "failed",
		error: "Permission denied",
	});
});
