import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { JedvParityViewContext } from "../../parity-types";
import { JedvPullRequestsView } from "./JedvPullRequestsView";

afterEach(cleanup);
test("PR browsing loads local content and checks without posting comments or merging", async () => {
	const addComment = mock(async () => ({ ok: true }));
	const merge = mock(async () => ({ merged: true }));
	const context = {
		hostUrl: "http://fixture.invalid",
		remote: null,
		projects: [
			{
				id: "project-fixture",
				name: "Fixture",
				repoOwner: "fixture",
				repoName: "repo",
			},
		],
		workspaces: [],
		onOpenWorkspace: mock(async () => {}),
		onOpenCreateWorkspace: mock(() => {}),
		client: {
			github: {
				getPullRequestDetail: {
					query: async () => ({
						mergeability: { allowedMergeMethods: ["squash"] },
						capabilities: { merge: true },
					}),
				},
				listPRs: {
					query: async () => [
						{
							number: 7,
							title: "Fixture pull request",
							state: "open",
							draft: false,
							merged_at: null,
							updated_at: new Date().toISOString(),
							head: { ref: "fixture-branch" },
							user: { login: "fixture" },
						},
					],
				},
			},
			pullRequests: {
				getContentByRepo: {
					query: async () => ({
						number: 7,
						title: "Fixture pull request",
						body: "Fixture description",
						url: "https://github.com/fixture/repo/pull/7",
						state: "OPEN",
						branch: "fixture-branch",
						baseBranch: "main",
						isDraft: false,
						author: "fixture",
						mergedAt: null,
						additions: 1,
						deletions: 0,
						changedFiles: 1,
						labels: [],
						comments: [],
						commits: [],
						checks: [{ name: "Fixture CI", status: "success", url: null }],
						checksStatus: "success",
						mergeability: "mergeable",
					}),
				},
				getLinkedWorkspace: { query: async () => ({ workspaceId: null }) },
				addComment: { mutate: addComment },
				mergePR: { mutate: merge },
			},
		},
	} as unknown as JedvParityViewContext;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: 1 } });
					emit.complete();
				}),
		],
	});
	const screen = render(
		<QueryClientProvider client={queries}>
			<electronTrpc.Provider client={ipc} queryClient={queries}>
				<JedvPullRequestsView {...context} />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: /Fixture pull request/ }),
		).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", { name: /Fixture pull request/ }));
	await waitFor(() =>
		expect(
			screen.getByRole("heading", { name: "Fixture pull request" }),
		).toBeTruthy(),
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
		target: { value: "Isolated fixture comment" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Comment" }));
	await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
	expect(addComment).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	fireEvent.click(screen.getByRole("button", { name: "Checks" }));
	await waitFor(() => expect(screen.getByText("Fixture CI")).toBeTruthy());
	expect(addComment).not.toHaveBeenCalled();
	expect(merge).not.toHaveBeenCalled();
	queries.clear();
});
