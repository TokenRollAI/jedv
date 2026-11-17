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

test("empty workspaces board hides Kanban columns and shows centered CTA, and working cards render bound agent icon", async () => {
	const onOpenCreateWorkspace = mock(() => {});
	const emptyProps = {
		client: {
			workspace: { list: { query: async () => [] } },
			terminalAgents: { list: { query: async () => [] } },
			pullRequests: {
				getByWorkspaces: { query: async () => ({ workspaces: [] }) },
			},
			settings: { workspacePresentation: { list: { query: async () => [] } } },
			terminal: { list: { query: async () => ({ sessions: [] }) } },
		},
		hostUrl: "http://empty.invalid",
		projects: [],
		workspaces: [],
		remote: null,
		onOpenWorkspace: async () => {},
		onOpenCreateWorkspace,
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
				<JedvWorkspacesBoard {...emptyProps} />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(screen.getByText("No workspaces yet")).toBeTruthy(),
	);
	expect(screen.queryByText("Idle")).toBeNull();
	expect(screen.queryByText("Needs attention")).toBeNull();
	const createButtons = screen.getAllByRole("button", {
		name: "Create workspace",
	});
	expect(createButtons).toHaveLength(2);
	if (!createButtons[1])
		throw new Error("Missing empty-state Create workspace button");
	fireEvent.click(createButtons[1]);
	expect(onOpenCreateWorkspace).toHaveBeenCalledTimes(1);

	const workingWorkspace = {
		id: "ws-working",
		projectId: "project",
		projectName: "Fixture",
		name: "agent-ws",
		branch: "agent-ws",
		type: "worktree",
		archivedAt: null,
		createdAt: new Date(),
	} as Workspace;
	const workingProps = {
		...emptyProps,
		hostUrl: "http://working.invalid",
		workspaces: [workingWorkspace],
		client: {
			...emptyProps.client,
			workspace: { list: { query: async () => [workingWorkspace] } },
			terminalAgents: {
				list: {
					query: async () => [
						{
							workspaceId: "ws-working",
							terminalId: "term-1",
							agentId: "codex",
							lastEventType: "Start",
							startedAt: 1,
							lastEventAt: 2,
							endedAt: null,
						},
					],
				},
			},
		},
	} as unknown as JedvParityViewContext;
	screen.rerender(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<JedvWorkspacesBoard {...workingProps} />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	await waitFor(() => expect(screen.getByText("agent-ws")).toBeTruthy());
	await waitFor(() => {
		const statusLabel = screen.getByLabelText("Working");
		expect(statusLabel.querySelector("img")).toBeTruthy();
	});
	cleanup();
	cache.clear();
});
