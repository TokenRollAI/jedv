import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { LocalClient } from "../../../../local-client";
import { PullRequestDraftMenu } from "./PullRequestDraftMenu";

afterEach(cleanup);
test("draft menu confirms the remote state change before sending fixture parameters", async () => {
	const change = mock(async () => ({ ok: true }));
	const client = {
		pullRequests: { setDraft: { mutate: change } },
	} as unknown as LocalClient;
	const queries = new QueryClient();
	const view = render(
		<QueryClientProvider client={queries}>
			<PullRequestDraftMenu
				client={client}
				target={{
					projectId: "project",
					owner: "fixture",
					repo: "repo",
					number: 7,
					title: "Fixture",
				}}
				isDraft={false}
				canUpdate
				canMarkReady={false}
				onUpdated={async () => {}}
			/>
		</QueryClientProvider>,
	);
	const choose = async () => {
		fireEvent.keyDown(view.getByRole("button", { name: "Change state" }), {
			key: "Enter",
		});
		await waitFor(() =>
			expect(view.getByRole("menuitemradio", { name: "Draft" })).toBeTruthy(),
		);
		fireEvent.click(view.getByRole("menuitemradio", { name: "Draft" }));
	};
	await choose();
	expect(change).not.toHaveBeenCalled();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(change).not.toHaveBeenCalled();
	await choose();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Confirm",
		}),
	);
	await waitFor(() =>
		expect(change).toHaveBeenCalledWith({
			projectId: "project",
			prNumber: 7,
			draft: true,
		}),
	);
	queries.clear();
});
