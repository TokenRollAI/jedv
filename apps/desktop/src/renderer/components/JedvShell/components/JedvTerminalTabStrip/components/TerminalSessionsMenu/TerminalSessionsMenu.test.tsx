import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { TerminalSession } from "../../../../types";
import { createTerminalWorkspaceStore } from "../../../JedvTerminalWorkspace/layout";
import type { TerminalSessionsMenuProps } from "../../types";
import { TerminalSessionsMenu } from "./TerminalSessionsMenu";

afterEach(cleanup);
function fixture() {
	const sessions = Array.from({ length: 45 }, (_, index) => ({
		terminalId: `terminal-${index}`,
		workspaceId: "w",
		createdAt: Date.now() - index * 60000,
		exited: false,
		exitCode: 0,
		attached: false,
		title: `Terminal ${index}`,
		customTitle: null,
	})) as TerminalSession[];
	const store = createTerminalWorkspaceStore();
	store.getState().addTab({
		id: "first",
		panes: [
			{ id: "pane", kind: "terminal", data: { terminalId: "terminal-0" } },
		],
	});
	const attach = mock((_id: string) => {});
	const kill = mock((_id: string) => {});
	const launch = mock((_input: unknown) => {});
	const props = {
		store,
		sessions,
		activeId: "terminal-0",
		enabled: true,
		connected: true,
		configs: [],
		onAttach: attach,
		onKill: kill,
		onLaunch: launch,
		onSettings: () => {},
		sessionPicker: {
			hostUrl: "http://original.invalid",
			workspaceId: "w",
			onSelectSession: async () => {},
			client: {
				terminal: { list: { query: async () => ({ sessions }) } },
				terminalAgents: {
					listByWorkspace: {
						query: async () => [
							{
								terminalId: "terminal-1",
								workspaceId: "w",
								lastEventType: "Start",
								agentId: "gemini",
								agentSessionId: "native-1",
							},
						],
					},
					resumeCandidates: { query: async () => [] },
				},
			},
		},
	} as unknown as TerminalSessionsMenuProps;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = (next = props) => (
		<QueryClientProvider client={cache}>
			<TerminalSessionsMenu {...next} />
		</QueryClientProvider>
	);
	return { props, cache, view, attach, kill, launch };
}
test("full scrollable list shows time and real binding Run; per-row kill targets only that row", async () => {
	const f = fixture();
	const screen = render(f.view());
	fireEvent.keyDown(screen.getByRole("button", { name: "Terminal sessions" }), {
		key: "Enter",
	});
	await screen.findByText("Run");
	expect(
		screen.container.ownerDocument
			.querySelector("[data-terminal-session-list]")
			?.className.includes("overflow-y-auto"),
	).toBe(true);
	expect(screen.getByText("Terminal 44")).toBeTruthy();
	expect(screen.getByText("Current")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Kill Terminal 44" }));
	await waitFor(() => expect(f.kill).toHaveBeenCalledWith("terminal-44"));
	expect(f.attach).not.toHaveBeenCalled();
	expect(f.launch).not.toHaveBeenCalled();
	cleanup();
	f.cache.clear();
});
test("disabled/offline menu cannot attach, kill or start a session", async () => {
	const f = fixture();
	const screen = render(
		f.view({ ...f.props, enabled: false, connected: false }),
	);
	fireEvent.keyDown(screen.getByRole("button", { name: "Terminal sessions" }), {
		key: "Enter",
	});
	const row = await screen.findByRole("button", { name: "Kill Terminal 0" });
	expect((row as HTMLButtonElement).disabled).toBe(true);
	expect(
		screen
			.getByRole("menuitem", { name: "Run agent…" })
			.getAttribute("data-disabled"),
	).not.toBeNull();
	expect(f.kill).not.toHaveBeenCalled();
	expect(f.attach).not.toHaveBeenCalled();
	expect(f.launch).not.toHaveBeenCalled();
	cleanup();
	f.cache.clear();
});
