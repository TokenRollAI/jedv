import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useWorkspaceReadReceipts } from "../JedvWorkspacesBoard/stores/read-receipts";
import { JedvProjectTree } from "./JedvProjectTree";
import type { JedvProjectTreeProps } from "./types";

afterEach(() => {
	cleanup();
	useWorkspaceReadReceipts.setState({ receipts: new Map() });
});
function fixture() {
	const rows = ["first", "second"].map((id) => ({
		id,
		projectId: "project",
		name: id,
		branch: id,
		type: "worktree",
		worktreePath: `/fixture/${id}`,
		tags: [],
		archivedAt: null,
	}));
	const reorder = mock(async (_input: unknown) => ({ success: true }));
	const kill = mock(async (_input: unknown) => ({ success: true }));
	const clear = mock(async (_input: unknown) => ({ success: true }));
	const opened = mock(async (_context: unknown, _id: string) => {});
	const props = {
		context: {
			hostUrl: "http://original.invalid",
			hostLabel: "Fixture host",
			isRemote: false,
			client: {
				settings: {
					workspacePresentation: {
						list: {
							query: async () =>
								rows.map((row, index) => ({
									workspaceId: row.id,
									pinned: false,
									position: index,
								})),
						},
						reorder: { mutate: reorder },
					},
				},
				workspace: { list: { query: async () => rows } },
				tagFolders: { list: { query: async () => [] } },
				ports: { getAll: { query: async () => [] }, kill: { mutate: kill } },
				pullRequests: {
					getByWorkspaces: { query: async () => ({ workspaces: [] }) },
				},
				terminalAgents: { clearWorkspaceStatuses: { mutate: clear } },
			},
		},
		projects: [
			{
				id: "project",
				name: "Fixture",
				repoPath: "/fixture/repo",
				icon: "none",
				color: null,
				repoOwner: null,
				tagSettings: [],
			},
		],
		workspaces: rows,
		bindings: [],
		activeWorkspaceId: null,
		navigation: {
			collapsedProjects: [],
			collapsedGroups: [],
			setCollapsedGroups: () => {},
			workspaceSortMode: "manual",
			setCollapsedProjects: () => {},
			setWorkspaceSortMode: () => {},
		},
		filter: "",
		onOpenWorkspace: opened,
		onCreateTerminal: async () => {},
		onLaunch: async () => {},
		onRename: async () => {},
		onDeleteWorkspace: () => {},
		onCopy: () => {},
		onProjectAction: () => {},
		onRemoveProject: () => {},
	} as unknown as JedvProjectTreeProps;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ipc = electronTrpc.createClient({
		links: [
			() =>
				({ op }) =>
					observable((emit) => {
						emit.next({
							result: {
								data: op.path === "settings.getDefaultEditor" ? null : [],
							},
						});
						emit.complete();
					}),
		],
	});
	const view = (next: JedvProjectTreeProps) => (
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<JedvProjectTree {...next} />
			</electronTrpc.Provider>
		</QueryClientProvider>
	);
	return { props, cache, view, reorder, clear, opened, kill };
}
test("manual full-project handles disappear under filtering or non-manual sort", async () => {
	const f = fixture();
	const screen = render(f.view(f.props));
	await waitFor(() =>
		expect(
			screen.getAllByRole("button", { name: "Reorder workspace" }).length,
		).toBe(2),
	);
	screen.rerender(f.view({ ...f.props, filter: "first" }));
	expect(screen.queryByText("second")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Reorder workspace" }),
	).toBeNull();
	screen.rerender(
		f.view({
			...f.props,
			navigation: { ...f.props.navigation, workspaceSortMode: "active" },
		}),
	);
	expect(
		screen.queryByRole("button", { name: "Reorder workspace" }),
	).toBeNull();
	expect(f.reorder).not.toHaveBeenCalled();
	cleanup();
	f.cache.clear();
});
test("workspace actions retain original context across async host changes", async () => {
	const f = fixture();
	let complete = () => {};
	const waiting = new Promise<void>((resolve) => {
		complete = resolve;
	});
	f.opened.mockImplementation(async () => {
		await waiting;
	});
	const screen = render(f.view(f.props));
	await screen.findByText("first");
	fireEvent.click(screen.getByText("first"));
	expect(f.opened.mock.calls[0]).toEqual([f.props.context, "first"]);
	screen.rerender(
		f.view({
			...f.props,
			context: { ...f.props.context, hostUrl: "http://different.invalid" },
		}),
	);
	await act(async () => complete());
	expect(f.opened).toHaveBeenCalledTimes(1);
	cleanup();
	f.cache.clear();
});

test("collapsed group keys survive navigation and never hide a same-named group on another host", async () => {
	const f = fixture();
	const originalKey = JSON.stringify([
		f.props.context.hostUrl,
		"project",
		"tag:one",
	]);
	const changed = mock((_keys: string[]) => {});
	const first = f.props.workspaces[0];
	if (!first) throw new Error("Missing fixture workspace");
	first.tags = ["one"];
	const props = {
		...f.props,
		navigation: {
			...f.props.navigation,
			collapsedGroups: [originalKey],
			setCollapsedGroups: changed,
		},
	};
	const screen = render(f.view(props));
	await screen.findByText("one");
	expect(screen.queryByText("first")).toBeNull();
	const different = {
		...props,
		context: { ...props.context, hostUrl: "http://different.invalid" },
	};
	screen.rerender(f.view(different));
	await screen.findByText("first");
	fireEvent.click(screen.getByRole("button", { name: /one 1/ }));
	expect(changed).toHaveBeenCalledWith([
		originalKey,
		JSON.stringify([different.context.hostUrl, "project", "tag:one"]),
	]);
	cleanup();
	f.cache.clear();
});

test("manual unread menu marks an idle workspace with the existing receipt cache", async () => {
	const f = fixture();
	const screen = render(f.view(f.props));
	fireEvent.contextMenu(await screen.findByText("first"));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Mark as unread" }),
	);
	await screen.findByRole("img", { name: "Unread activity" });

	cleanup();
	f.cache.clear();
});
test("listening process menu opens an explicit original-host PID confirmation and cancel never kills", async () => {
	const f = fixture();
	f.props.context.client.ports.getAll.query = async () => [
		{
			workspaceId: "first",
			terminalId: "terminal",
			port: 3000,
			pid: 123,
			processName: "fixture-server",
			address: "127.0.0.1",
			detectedAt: 1,
			label: null,
		},
	];
	const screen = render(f.view(f.props));
	await screen.findByText("first");
	await waitFor(() =>
		expect(screen.getAllByText("1").length).toBeGreaterThan(0),
	);
	fireEvent.contextMenu(screen.getByText("first"));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Stop listening processes…" }),
	);
	await screen.findByRole("alertdialog", { name: "Stop listening processes?" });
	expect(screen.getByText(/PID 123/).textContent).toContain(
		"http://original.invalid",
	);
	expect(f.kill).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(f.kill).not.toHaveBeenCalled();
	cleanup();
	f.cache.clear();
});
