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
								branch: "main",
								path: "/fixture/main",
								hasWorkspace: true,
								workspaceId: "local",
								isMainWorktree: true,
							},
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
	fireEvent.change(f.screen.getByLabelText("New branch name"), {
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

test("shared checkout conflicts are field errors with a safe local checkout action", async () => {
	const f = fixture();
	const input = f.screen.getByLabelText("New branch name");
	fireEvent.change(input, { target: { value: "main" } });
	await f.screen.findByText(
		"This branch is used by the shared checkout. Choose a new name or use the local checkout.",
	);
	expect(input.getAttribute("aria-invalid")).toBe("true");
	expect(
		(
			f.screen.getByRole("button", {
				name: "Create workspace",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(f.create).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: "Use local checkout" }));
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() => expect(f.create).toHaveBeenCalledTimes(1));
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		checkout: "local",
		runSetup: false,
	});
	expect(f.create.mock.calls[0]?.[0]).not.toHaveProperty("branch");
	f.queryClient.clear();
});
test("new branch keeps the name distinct from base and detects occupied worktrees", async () => {
	const f = fixture();
	const input = f.screen.getByLabelText("New branch name");
	expect((input as HTMLInputElement).value).toBe("");
	await f.screen.findByText("main");
	fireEvent.change(input, { target: { value: "feature/imported" } });
	await f.screen.findByText(
		"This branch already exists. Choose a new name or select Existing branch.",
	);
	fireEvent.change(input, { target: { value: "feature/fresh" } });
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() => expect(f.create).toHaveBeenCalledTimes(1));
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		checkout: "worktree",
		branch: "feature/fresh",
	});
	f.queryClient.clear();
});

test("a shared checkout race from the Host becomes a translated field error", async () => {
	const f = fixture();
	f.create.mockImplementationOnce(async () => {
		throw new Error(
			"This branch uses the project's shared checkout. Create a Local workspace or choose another branch for a worktree.",
		);
	});
	fireEvent.change(f.screen.getByLabelText("New branch name"), {
		target: { value: "fresh-before-race" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await f.screen.findByText(
		"This branch is used by the shared checkout. Choose a new name or use the local checkout.",
	);
	expect(
		f.screen.queryByText(/Create a Local workspace or choose another branch/),
	).toBeNull();
	expect(
		f.screen.getByRole("button", { name: "Use local checkout" }),
	).toBeTruthy();
	f.queryClient.clear();
});
