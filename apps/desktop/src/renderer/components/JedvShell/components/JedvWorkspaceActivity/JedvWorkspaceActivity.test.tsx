import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { AgentIslandEntry } from "shared/types/agent-island";
import type { LocalClient } from "../../local-client";
import { JedvWorkspaceActivity } from "./JedvWorkspaceActivity";
import {
	activityEntries,
	needsAttention,
	runningWorkCount,
} from "./utils/activityEntries";
import { changesPillStats } from "./utils/changesPillStats";

afterEach(cleanup);
const entry: AgentIslandEntry = {
	entryId: "a",
	workspaceId: "w",
	workspaceName: "Fixture",
	projectName: "Project",
	provider: "codex",
	nativeSessionId: "native",
	profileHash: "profile",
	terminalId: "waiting",
	activeWriter: "cli",
	leaseEpoch: 1,
	turnState: "awaiting-approval",
	completedUnread: false,
	pendingApprovals: [],
};
test("activity keeps distinct paths and native identities once and prefers the current lease", () => {
	expect(
		changesPillStats({
			againstBase: [{ path: "a", additions: 10, deletions: 1 }],
			staged: [{ path: "a", additions: 2, deletions: 0 }],
			unstaged: [{ path: "a", additions: 3, deletions: 0 }],
		}),
	).toEqual({ fileCount: 1, additions: 3, deletions: 0 });
	const entries = activityEntries("http://fixture", "w", [
		entry,
		{ ...entry, entryId: "duplicate", leaseEpoch: 2, turnState: "idle" },
		{ ...entry, entryId: "other", workspaceId: "other" },
	]);
	expect(entries).toHaveLength(1);
	expect(entries[0].leaseEpoch).toBe(2);
	expect(needsAttention(entries[0])).toBe(false);
});
test("the in-app menu exposes real waiting and background navigation without requiring OS notifications", async () => {
	const openTerminal = mock(async () => {}),
		openChanges = mock(() => {});
	const client = {
		git: {
			getStatus: {
				query: async () => ({ againstBase: [], staged: [], unstaged: [] }),
			},
		},
		pullRequests: {
			getByWorkspaces: { query: async () => ({ workspaces: [] }) },
			historyByWorkspaces: {
				query: async () => ({
					workspaces: [{ workspaceId: "w", pullRequests: [] }],
				}),
			},
		},
		terminal: {
			list: {
				query: async () => ({
					sessions: [
						{
							terminalId: "visible",
							title: "Visible fixture",
							createdAt: 1,
							exited: false,
						},
						{
							terminalId: "background",
							title: "Background fixture",
							createdAt: 1,
							exited: false,
						},
					],
				}),
			},
		},
	} as unknown as LocalClient;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={queries}>
			<JedvWorkspaceActivity
				client={client}
				hostUrl="http://fixture-activity"
				workspaceId="w"
				workspaceName="Fixture"
				attachedTerminalIds={["visible"]}
				agentSource={{
					status: "ready",
					entries: [entry, { ...entry, entryId: "duplicate" }],
				}}
				onOpenChanges={openChanges}
				onOpenPullRequests={() => {}}
				onOpenTerminal={openTerminal}
			/>
		</QueryClientProvider>,
	);
	fireEvent.click(view.getByRole("button", { name: "Workspace activity" }));
	await waitFor(() =>
		expect(
			view.getByRole("button", { name: /^Background fixture/ }),
		).toBeTruthy(),
	);
	expect(view.queryByText("Visible fixture")).toBeNull();
	expect(
		view.getAllByRole("button", { name: /codex.*Awaiting Response/ }),
	).toHaveLength(1);
	fireEvent.click(
		view.getByRole("button", { name: /codex.*Awaiting Response/ }),
	);
	await waitFor(() => expect(openTerminal).toHaveBeenCalledWith("waiting"));
	expect(openChanges).not.toHaveBeenCalled();
	queries.clear();
});

test("one detached native terminal contributes one running work identity", () => {
	expect(
		runningWorkCount(
			[{ ...entry, terminalId: "same", turnState: "running" }],
			[{ terminalId: "same" }],
		),
	).toBe(1);
	expect(
		runningWorkCount(
			[{ ...entry, terminalId: "agent", turnState: "running" }],
			[{ terminalId: "server" }],
		),
	).toBe(2);
});

test("docked navigation keeps one activity panel while floating navigation can close", async () => {
	const dock = document.createElement("aside");
	document.body.appendChild(dock);
	const client = {
		git: {
			getStatus: {
				query: async () => ({ againstBase: [], staged: [], unstaged: [] }),
			},
		},
		pullRequests: {
			getByWorkspaces: { query: async () => ({ workspaces: [] }) },
			historyByWorkspaces: { query: async () => ({ workspaces: [] }) },
		},
		terminal: { list: { query: async () => ({ sessions: [] }) } },
	} as unknown as LocalClient;
	const query = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onOpenChanges = mock(() => {});
	const onHidden = mock(() => {});
	const view = render(
		<QueryClientProvider client={query}>
			<JedvWorkspaceActivity
				client={client}
				hostUrl="http://dock-fixture"
				workspaceId="w"
				workspaceName="Dock fixture"
				dockTarget={dock}
				dockFits
				dockHidden={false}
				onDockHiddenChange={onHidden}
				attachedTerminalIds={[]}
				agentSource={{ status: "ready", entries: [] }}
				onOpenChanges={onOpenChanges}
				onOpenPullRequests={() => {}}
				onOpenTerminal={() => {}}
			/>
		</QueryClientProvider>,
	);
	fireEvent.click(view.getByRole("button", { name: "Changes" }));
	await waitFor(() => expect(onOpenChanges).toHaveBeenCalledTimes(1));
	expect(onHidden).not.toHaveBeenCalled();
	expect(document.querySelectorAll("[data-activity-panel]")).toHaveLength(1);
	expect(dock.querySelector("[data-activity-panel]")).not.toBeNull();
	view.unmount();
	query.clear();
	dock.remove();
});

test("chat sessions display real titles alongside agent name and open via onOpenChat", async () => {
	const onOpenChat = mock(() => {});
	const client = {
		git: {
			getStatus: {
				query: async () => ({ againstBase: [], staged: [], unstaged: [] }),
			},
		},
		pullRequests: {
			getByWorkspaces: { query: async () => ({ workspaces: [] }) },
			historyByWorkspaces: { query: async () => ({ workspaces: [] }) },
		},
		terminal: { list: { query: async () => ({ sessions: [] }) } },
	} as unknown as LocalClient;
	const query = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={query}>
			<JedvWorkspaceActivity
				client={client}
				hostUrl="http://chat-activity"
				workspaceId="w"
				workspaceName="Workspace"
				attachedTerminalIds={[]}
				agentSource={{ status: "ready", entries: [] }}
				chatSessions={[
					{
						sessionId: "chat-1",
						harness: "claude-code",
						title: "Audit sidebar density",
						live: true,
						status: "idle",
					},
				]}
				onOpenChat={onOpenChat}
				onOpenChanges={() => {}}
				onOpenPullRequests={() => {}}
				onOpenTerminal={() => {}}
			/>
		</QueryClientProvider>,
	);
	fireEvent.click(view.getByRole("button", { name: "Workspace activity" }));
	const row = await view.findByRole("button", {
		name: /claude.*Audit sidebar density/,
	});
	fireEvent.click(row);
	await waitFor(() =>
		expect(onOpenChat).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "chat-1",
				title: "Audit sidebar density",
			}),
		),
	);
	query.clear();
});
