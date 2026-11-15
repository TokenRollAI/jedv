import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { LocalClient } from "../../../../../../local-client";
import { ReviewThread } from "./ReviewThread";

afterEach(cleanup);
function fixture() {
	const reply = mock(async () => ({}));
	const resolve = mock(async () => ({}));
	const client = {
		pullRequests: {
			replyToThread: { mutate: reply },
			setThreadResolution: { mutate: resolve },
		},
	} as unknown as LocalClient;
	const queries = new QueryClient();
	const view = render(
		<QueryClientProvider client={queries}>
			<ReviewThread
				thread={{
					id: "thread",
					path: "file.ts",
					line: 3,
					diffSide: "RIGHT",
					isResolved: false,
					isOutdated: false,
					comments: [
						{
							id: "comment",
							databaseId: 42,
							author: { login: "reviewer", avatarUrl: "" },
							body: "Fixture review",
							createdAt: "2026-01-01T00:00:00Z",
						},
					],
				}}
				client={client}
				target={{
					projectId: "project",
					owner: "fixture",
					repo: "repo",
					number: 7,
					title: "Fixture",
				}}
				viewerLogin="author"
				canUpdate
				onUpdated={async () => {}}
			/>
		</QueryClientProvider>,
	);
	return { view, reply, resolve, queries };
}
test("thread reply cancellation sends nothing and confirmation sends fixture comment ID", async () => {
	const { view, reply, queries } = fixture();
	fireEvent.change(view.getByRole("textbox", { name: "Write a reply…" }), {
		target: { value: "Fixture reply" },
	});
	fireEvent.click(view.getByRole("button", { name: "Reply" }));
	expect(reply).not.toHaveBeenCalled();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(reply).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Reply" }));
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Confirm",
		}),
	);
	await waitFor(() =>
		expect(reply).toHaveBeenCalledWith({
			projectId: "project",
			prNumber: 7,
			commentId: 42,
			body: "Fixture reply",
		}),
	);
	queries.clear();
});
test("thread resolution cancellation sends nothing and confirmation sends fixture thread ID", async () => {
	const { view, resolve, queries } = fixture();
	fireEvent.click(view.getByRole("button", { name: "Resolve conversation" }));
	expect(resolve).not.toHaveBeenCalled();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(resolve).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Resolve conversation" }));
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Confirm",
		}),
	);
	await waitFor(() =>
		expect(resolve).toHaveBeenCalledWith({
			threadId: "thread",
			resolved: true,
		}),
	);
	queries.clear();
});
