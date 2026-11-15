import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ProjectActionContext } from "../JedvProjectActions";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import type { WorkspaceCreateMode } from "./types";

afterEach(cleanup);
function fixture(mode: WorkspaceCreateMode = "new") {
	const create = mock(async (_input: unknown) => ({
		workspace: { id: "workspace-created" },
		terminals: [],
	}));
	const prs = mock(async () => ({
		pullRequests: [],
		hasNextPage: false,
		page: 1,
		totalCount: 0,
	}));
	const context = {
		client: {
			workspaces: { create: { mutate: create } },
			workspaceCreation: {
				searchBranches: {
					query: async () => ({
						defaultBranch: "main",
						items: [],
						nextCursor: null,
					}),
				},
				searchPullRequests: { query: prs },
				listProjectWorktrees: {
					query: async () => ({
						worktrees: [
							{
								branch: "feature/imported",
								path: "/fixture/imported",
								hasWorkspace: false,
								workspaceId: null,
								isMainWorktree: false,
							},
						],
					}),
				},
			},
		},
		hostUrl: "http://original.invalid",
		hostLabel: "Fixture",
		isRemote: true,
	} as unknown as ProjectActionContext;
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const opened = mock(async (_result: unknown) => {});
	const refresh = mock(async () => {});
	const screen = render(
		<QueryClientProvider client={queryClient}>
			<CreateWorkspaceDialog
				context={context}
				projects={[{ id: "project-1", name: "Fixture project" }]}
				initialMode={mode}
				onCreated={opened}
				onRefresh={refresh}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
	return { create, prs, context, queryClient, opened, screen };
}
test("local checkout creates a real workspace without branch switching or setup", async () => {
	const f = fixture("local");
	expect(f.prs).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() => expect(f.opened).toHaveBeenCalled());
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		projectId: "project-1",
		checkout: "local",
		trackSetupCompletion: true,
		runSetup: false,
		id: expect.any(String),
	});
	expect(f.create.mock.calls[0]?.[0]).not.toHaveProperty("branch");
	f.queryClient.clear();
});
test("PR creation sends the PR number instead of a conflicting branch input", async () => {
	const f = fixture("pr");
	fireEvent.change(f.screen.getByLabelText("Pull request number"), {
		target: { value: "42" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() => expect(f.create).toHaveBeenCalled());
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		projectId: "project-1",
		checkout: "worktree",
		pr: 42,
		trackSetupCompletion: true,
		runSetup: true,
	});
	expect(f.create.mock.calls[0]?.[0]).not.toHaveProperty("branch");
	f.queryClient.clear();
});
test("saved workspaces survive refresh failures and are not recreated", async () => {
	const f = fixture("new");
	f.opened.mockImplementationOnce(async () => {
		throw new Error("navigation interrupted");
	});
	fireEvent.change(f.screen.getByLabelText("Branch name"), {
		target: { value: "feature/example" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() =>
		expect(
			f.screen.getByRole("button", { name: "Continue opening" }),
		).toBeTruthy(),
	);
	fireEvent.click(f.screen.getByRole("button", { name: "Continue opening" }));
	await waitFor(() => expect(f.opened).toHaveBeenCalledTimes(2));
	expect(f.create).toHaveBeenCalledTimes(1);
	f.queryClient.clear();
});

test("plain folder workspace disables Git modes and makes no branch, PR or worktree queries", async () => {
	const gitQuery = mock(async () => {
		throw new Error("Git must remain disabled");
	});
	const create = mock(async (_input: unknown) => ({
		workspace: { id: "created" },
		terminals: [],
	}));
	const context = {
		hostUrl: "http://folder.invalid",
		hostLabel: "Folder host",
		isRemote: true,
		client: {
			workspaces: { create: { mutate: create } },
			workspaceCreation: {
				searchBranches: { query: gitQuery },
				searchPullRequests: { query: gitQuery },
				listProjectWorktrees: { query: gitQuery },
			},
		},
	} as unknown as ProjectActionContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={cache}>
			<CreateWorkspaceDialog
				context={context}
				projects={[
					{
						id: "folder",
						name: "Plain",
						vcsKind: "none",
						capabilities: { git: false, pullRequests: false, worktrees: false },
					},
				]}
				onRefresh={async () => {}}
				onCreated={async () => {}}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
	for (const name of [
		"New branch",
		"Existing branch",
		"Pull request",
		"Import worktree",
	])
		expect(
			(screen.getByRole("tab", { name }) as HTMLButtonElement).disabled,
		).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() => expect(create).toHaveBeenCalled());
	expect(create.mock.calls[0]?.[0]).toMatchObject({
		projectId: "folder",
		checkout: "local",
		runSetup: false,
	});
	expect(create.mock.calls[0]?.[0]).not.toHaveProperty("branch");
	expect(gitQuery).not.toHaveBeenCalled();
	cleanup();
	cache.clear();
});
