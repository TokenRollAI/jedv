import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { JedvParityViewContext } from "../../parity-types";
import type { Workspace } from "../../types";
import { JedvWorkspacesBoard } from "./JedvWorkspacesBoard";

afterEach(cleanup);
test("bulk candidates use visible live rows, start unselected and inspect only the explicit selection", async () => {
	const rows = ["first", "second"].map((id) => ({
		id,
		projectId: "project",
		projectName: "Fixture",
		name: id,
		branch: id,
		type: "worktree",
		archivedAt: null,
		createdAt: new Date(),
	})) as Workspace[];
	const inspect = mock(async (_input: unknown) => ({
		canDelete: true,
		hasChanges: false,
		hasUnpushed: false,
		isProtected: false,
	}));
	const destroy = mock(async () => ({}));
	const props = {
		client: {
			workspace: { list: { query: async () => rows } },
			terminalAgents: { list: { query: async () => [] } },
			pullRequests: {
				getByWorkspaces: { query: async () => ({ workspaces: [] }) },
			},
			settings: { workspacePresentation: { list: { query: async () => [] } } },
			workspaceCleanup: {
				inspect: { query: inspect },
				destroy: { mutate: destroy },
			},
			terminal: { list: { query: async () => ({ sessions: [] }) } },
		},
		hostUrl: "http://fixture.invalid",
		projects: [],
		workspaces: rows,
		remote: null,
		onOpenWorkspace: async () => {},
		onOpenCreateWorkspace: () => {},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
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
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<JedvWorkspacesBoard {...props} getHasUnsavedFiles={() => false} />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Search workspaces" }), {
		target: { value: "first" },
	});
	fireEvent.click(
		screen.getByRole("button", { name: "Delete multiple workspaces" }),
	);
	const checkbox = await screen.findByRole("checkbox", { name: "first" });
	expect(screen.queryByRole("checkbox", { name: "second" })).toBeNull();
	expect(checkbox.getAttribute("aria-checked")).toBe("false");
	expect(
		(
			screen.getByRole("button", {
				name: "Review selected workspaces",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(inspect).not.toHaveBeenCalled();
	fireEvent.click(checkbox);
	fireEvent.click(
		screen.getByRole("button", { name: "Review selected workspaces" }),
	);
	await waitFor(() =>
		expect(inspect).toHaveBeenCalledWith({ workspaceId: "first" }),
	);
	expect(inspect).toHaveBeenCalledTimes(1);
	expect(destroy).not.toHaveBeenCalled();
	cleanup();
	cache.clear();
});
