import { expect, test } from "bun:test";
import {
	ensureLocalCheckout,
	type LocalProjectActions,
	LocalProjectError,
	openLocalProject,
} from "./local-workflow";

function fixture(overrides: Partial<LocalProjectActions> = {}) {
	const calls: unknown[] = [];
	const actions: LocalProjectActions = {
		findProject: async (input) => {
			calls.push(["find", input]);
			return { candidates: [] };
		},
		importProject: async (input) => {
			calls.push(["import", input]);
			return { projectId: "project-1" };
		},
		listWorkspaces: async () => [],
		createWorkspace: async (input) => {
			calls.push(["checkout", input]);
			return { workspace: { id: "workspace-1" } };
		},
		...overrides,
	};
	return { actions, calls };
}

test("finds the repository before importing and opens a local checkout without setup", async () => {
	const { actions, calls } = fixture();
	expect(await openLocalProject(actions, " /tmp/my-repo/ ")).toBe(
		"workspace-1",
	);
	expect(calls).toEqual([
		["find", { repoPath: "/tmp/my-repo/" }],
		[
			"import",
			{
				name: "my-repo",
				mode: {
					kind: "importLocal",
					repoPath: "/tmp/my-repo/",
					initIfNeeded: false,
				},
			},
		],
		[
			"checkout",
			{ projectId: "project-1", checkout: "local", runSetup: false },
		],
	]);
});
test("reopening a known project reuses its existing local checkout", async () => {
	const { actions, calls } = fixture({
		findProject: async () => ({
			candidates: [{ id: "existing", name: "Custom name" }],
		}),
		listWorkspaces: async () => [
			{ id: "existing-checkout", projectId: "existing", type: "local" },
		],
	});
	expect(await openLocalProject(actions, "/tmp/repo")).toBe(
		"existing-checkout",
	);
	expect(calls).toEqual([]);
});
test("a non-git directory is not mutated when initialization is declined", async () => {
	const { actions, calls } = fixture({
		findProject: async () => ({ candidates: [], needsGitInit: true }),
		requestGitInit: async () => false,
	});
	expect(await openLocalProject(actions, "/tmp/plain")).toBeNull();
	expect(calls).toEqual([]);
});
test("explicit initialization consent is the only route to initIfNeeded true", async () => {
	const { actions, calls } = fixture({
		findProject: async () => ({ candidates: [], needsGitInit: true }),
		requestGitInit: async (path) => path === "/tmp/plain",
	});
	await openLocalProject(actions, "/tmp/plain");
	expect(calls[0]).toEqual([
		"import",
		{
			name: "plain",
			mode: { kind: "importLocal", repoPath: "/tmp/plain", initIfNeeded: true },
		},
	]);
});
test("a workspace failure retains the project identity and retries checkout without importing", async () => {
	const { actions } = fixture({
		createWorkspace: async () => {
			throw new Error("offline");
		},
	});
	try {
		await openLocalProject(actions, "/tmp/repo");
		throw new Error("expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(LocalProjectError);
		expect((error as LocalProjectError).projectId).toBe("project-1");
	}
	expect(
		await ensureLocalCheckout(
			{
				...actions,
				listWorkspaces: async () => [
					{ id: "completed", projectId: "project-1", type: "local" },
				],
			},
			"project-1",
		),
	).toBe("completed");
});
test("ambiguous candidates never create or choose a project automatically", async () => {
	const { actions, calls } = fixture({
		findProject: async () => ({
			candidates: [
				{ id: "one", name: "one" },
				{ id: "two", name: "two" },
			],
		}),
	});
	await expect(openLocalProject(actions, "/tmp/repo")).rejects.toMatchObject({
		reason: "multiple-projects",
	});
	expect(calls).toEqual([]);
});
test("import failure never creates a checkout", async () => {
	const { actions, calls } = fixture({
		importProject: async () => {
			throw new Error("permission denied");
		},
	});
	await expect(openLocalProject(actions, "/tmp/repo")).rejects.toThrow(
		"permission denied",
	);
	expect(calls).toEqual([["find", { repoPath: "/tmp/repo" }]]);
});
