import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { JedvChangesSummary } from "./components/JedvChangesSummary";
import { JedvTerminalTabStrip } from "./components/JedvTerminalTabStrip";
import { createTerminalWorkspaceStore } from "./components/JedvTerminalWorkspace/layout";
import { RightSidebarToggle } from "./components/RightSidebarToggle";
import type { LocalClient } from "./local-client";

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
