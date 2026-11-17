import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { JedvChangesSummary } from "./components/JedvChangesSummary";
import { JedvTerminalTabStrip } from "./components/JedvTerminalTabStrip";
import { createTerminalWorkspaceStore } from "./components/JedvTerminalWorkspace/layout";
import { JedvWorkspaceRow } from "./components/JedvWorkspaceRow";
import { RightSidebarToggle } from "./components/RightSidebarToggle";
import type { LocalClient } from "./local-client";
import type { Workspace } from "./types";

afterEach(cleanup);

test("JedvTerminalTabStrip renders quick launch bar when workspace sessionPicker is active and places Files next to Changes", () => {
	const store = createTerminalWorkspaceStore();
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: null } });
					emit.complete();
				}),
		],
	});
	const view = render(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<JedvTerminalTabStrip
					store={store}
					sessions={[]}
					onTabBarMount={() => {}}
					onAttach={() => {}}
					onKill={() => {}}
					onLaunch={() => {}}
					onSettings={() => {}}
					agentConfigs={[]}
					sessionPicker={{
						client: {} as unknown as LocalClient,
						hostUrl: "http://127.0.0.1:1",
						workspaceId: "ws-1",
						onSelectSession: async () => {},
					}}
					files={<button type="button">Files</button>}
					changes={<span>Changes summary</span>}
					tools={<span>Tools</span>}
					enabled
					connected
					showPresetsBar
					presets={[
						{
							id: "p1",
							name: "Dev Server",
							commands: ["bun dev"],
							cwd: "",
							executionMode: "new-tab",
							pinnedToBar: true,
						},
					]}
					onRunPreset={() => {}}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	expect(
		view.getByRole("button", { name: "Manage Terminal Scripts" }),
	).toBeDefined();
	expect(view.getByText("Dev Server")).toBeDefined();
	const filesButton = view.getByRole("button", { name: "Files" });
	const changesEl = view.getByText("Changes summary");
	expect(
		filesButton.compareDocumentPosition(changesEl) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	view.unmount();
});

test("JedvChangesSummary toggles changes directly in 1 click and RightSidebarToggle supports disabled", async () => {
	const onOpenChanges = mock(() => {});
	const onToggle = mock(() => {});
	const client = {
		git: {
			getStatus: {
				query: async () => ({
					currentBranch: { name: "main" },
					againstBase: [{ path: "a.ts", additions: 5, deletions: 2 }],
					staged: [],
					unstaged: [],
				}),
			},
		},
	} as unknown as LocalClient;
	const query = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={query}>
			<JedvChangesSummary
				client={client}
				hostUrl="http://fixture.invalid"
				workspaceId="w1"
				active
				isOpen={false}
				onOpenChanges={onOpenChanges}
			/>
			<RightSidebarToggle isOpen={false} disabled onToggle={onToggle} />
		</QueryClientProvider>,
	);
	await waitFor(() => expect(view.getByText("+5")).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "Changes" }));
	expect(onOpenChanges).toHaveBeenCalledTimes(1);
	const toggle = view.getByRole("button", { name: "Toggle right sidebar" });
	expect(toggle.hasAttribute("disabled")).toBe(true);
	fireEvent.click(toggle);
	expect(onToggle).not.toHaveBeenCalled();
	query.clear();
});

test("JedvWorkspaceRow isolates statusActions from long workspace names and JedvShell pins ResizablePanel order", async () => {
	const workspace = {
		id: "ws-overlap",
		projectId: "proj-1",
		type: "worktree",
		name: "深度体验 jedv 并排查交互与 UI 问题",
		branch: "feat/dogfood",
		worktreePath: "/tmp/ws-overlap",
		tabOrder: 0,
		createdAt: 1,
		updatedAt: 1,
		archivedAt: null,
	} as unknown as Workspace;
	const view = render(
		<JedvWorkspaceRow
			workspace={workspace}
			active
			ports={[3000, 5173]}
			hasPullRequest
			statusActions={<span data-testid="row-status-actions">PR+Ports</span>}
			onSelect={() => {}}
			onNewTerminal={() => {}}
			onLaunch={() => {}}
			onRename={() => {}}
			onCopy={() => {}}
			onDelete={() => {}}
		/>,
	);
	const rowButton = view.getByRole("button", {
		name: /深度体验 jedv 并排查交互与 UI 问题/,
	});
	expect(rowButton.className).toContain("overflow-hidden");
	const actionsSlot = view.getByTestId("row-status-actions").parentElement;
	expect(actionsSlot?.className).toContain("shrink-0");
	expect(actionsSlot?.className).not.toContain("absolute");
	expect(rowButton.contains(actionsSlot)).toBe(false);
	view.unmount();

	const shellSource = await Bun.file(
		new URL("./JedvShell.tsx", import.meta.url),
	).text();
	expect(shellSource).toContain('id="jedv-shell-sidebar"');
	expect(shellSource).toContain('id="jedv-shell-main"');
	expect(shellSource).toContain("order={1}");
	expect(shellSource).toContain("order={2}");
});
