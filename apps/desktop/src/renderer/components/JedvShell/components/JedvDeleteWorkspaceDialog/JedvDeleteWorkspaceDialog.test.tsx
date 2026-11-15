import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { Workspace } from "../../types";
import type { ProjectActionContext } from "../JedvProjectActions";
import { JedvDeleteWorkspaceDialog } from "./JedvDeleteWorkspaceDialog";

afterEach(cleanup);
function fixture(dirty = false, unsaved = false) {
	const destroy = mock(async (_input: unknown) => ({ warnings: [] }));
	const inspect = mock(async () => ({
		canDelete: true,
		reason: null,
		hasChanges: dirty,
		hasUnpushedCommits: false,
		sharesProjectCheckout: false,
	}));
	const context = {
		client: {
			workspaceCleanup: {
				inspect: { query: inspect },
				destroy: { mutate: destroy },
			},
			terminal: {
				list: { query: async () => ({ sessions: [{ exited: false }] }) },
			},
		},
		hostUrl: "http://original.invalid",
		hostLabel: "Fixture",
		isRemote: true,
	} as unknown as ProjectActionContext;
	const workspace = {
		id: "workspace-1",
		name: "Fixture workspace",
		branch: "feature/example",
		type: "worktree",
		worktreePath: "/fixture/worktree",
	} as Workspace;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const deleted = mock(async () => {});
	const refresh = mock(async () => {});
	function Harness() {
		const [open, setOpen] = useState(true);
		return (
			<QueryClientProvider client={queries}>
				{open && (
					<JedvDeleteWorkspaceDialog
						context={context}
						workspace={workspace}
						hasUnsavedFiles={unsaved}
						onDeleted={deleted}
						onRefresh={refresh}
						onClose={() => setOpen(false)}
					/>
				)}
			</QueryClientProvider>
		);
	}
	const screen = render(<Harness />);
	return { destroy, inspect, context, queries, deleted, screen };
}
test("dirty deletion requires explicit force consent and retains teardown", async () => {
	const f = fixture(true);
	await waitFor(() =>
		expect(f.screen.getByText("Has uncommitted changes")).toBeTruthy(),
	);
	expect(f.destroy).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: "Delete anyway" }));
	await waitFor(() => expect(f.deleted).toHaveBeenCalled());
	await waitFor(() => expect(f.screen.queryByRole("alertdialog")).toBeNull());
	expect(f.destroy).toHaveBeenCalledWith({
		workspaceId: "workspace-1",
		deleteBranch: false,
		force: true,
		skipTeardown: false,
	});
	expect(f.inspect).toHaveBeenCalledTimes(2);
});
test("teardown failure requires a second explicit choice to skip and keeps git consent separate", async () => {
	const f = fixture(false);
	f.destroy.mockImplementationOnce(async () => {
		throw Object.assign(new Error("teardown failed"), {
			data: {
				teardownFailure: {
					kind: "TEARDOWN_FAILED",
					exitCode: 1,
					timedOut: false,
					outputTail: "fixture error",
				},
			},
		});
	});
	await waitFor(() =>
		expect(
			(f.screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(f.screen.getByRole("button", { name: "Delete" }));
	await waitFor(() =>
		expect(
			f.screen.getByText(/skip the teardown script entirely/),
		).toBeTruthy(),
	);
	expect(f.destroy).toHaveBeenCalledTimes(1);
	fireEvent.click(f.screen.getByRole("button", { name: "Delete anyway" }));
	await waitFor(() => expect(f.deleted).toHaveBeenCalled());
	await waitFor(() => expect(f.screen.queryByRole("alertdialog")).toBeNull());
	expect(f.destroy.mock.calls[1]?.[0]).toEqual({
		workspaceId: "workspace-1",
		deleteBranch: false,
		force: false,
		skipTeardown: true,
	});
});
test("unsaved files block destroy even when the host permits it", async () => {
	const f = fixture(false, true);
	await waitFor(() =>
		expect(
			f.screen.getByText(/running terminal sessions will stop/),
		).toBeTruthy(),
	);
	await waitFor(() =>
		expect(f.screen.getByText(/Save or close every unsaved file/)).toBeTruthy(),
	);
	expect(
		(f.screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(f.destroy).not.toHaveBeenCalled();
});
