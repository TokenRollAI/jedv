import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { JedvParityViewContext } from "../../../../parity-types";
import { CreatePullRequestDialog } from "./CreatePullRequestDialog";

afterEach(cleanup);
test("creating a PR requires confirmation and sends the selected workspace only to the fixture", async () => {
	const create = mock(async () => ({
		number: 7,
		url: "https://github.com/fixture/repo/pull/7",
	}));
	const onCreated = mock(() => {});
	const context = {
		hostUrl: "fixture-host",
		projects: [{ id: "project", repoOwner: "fixture", repoName: "repo" }],
		workspaces: [
			{
				id: "workspace",
				projectId: "project",
				name: "Fixture workspace",
				branch: "feature",
				archivedAt: null,
				worktreeExists: true,
			},
		],
		client: {
			github: {
				getRepo: {
					query: async () => ({
						default_branch: "main",
						permissions: { push: true },
					}),
				},
			},
			pullRequests: { createForWorkspace: { mutate: create } },
		},
	} as unknown as JedvParityViewContext;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={queries}>
			<CreatePullRequestDialog
				context={context}
				onCreated={onCreated}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
	fireEvent.change(view.getByRole("textbox", { name: "Pull request title" }), {
		target: { value: "Fixture PR" },
	});
	fireEvent.change(
		view.getByRole("textbox", { name: "Description (optional)" }),
		{ target: { value: "Fixture body" } },
	);
	fireEvent.click(view.getByRole("checkbox", { name: "Draft" }));
	await waitFor(() =>
		expect(
			view
				.getByRole("button", { name: "Create pull request" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(view.getByRole("button", { name: "Create pull request" }));
	expect(create).not.toHaveBeenCalled();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(create).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Create pull request" }));
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Confirm",
		}),
	);
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith({
			workspaceId: "workspace",
			title: "Fixture PR",
			body: "Fixture body",
			draft: true,
		}),
	);
	await waitFor(() => expect(onCreated).toHaveBeenCalled());
	queries.clear();
});
