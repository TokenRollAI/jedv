import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { JedvParityViewContext } from "../../../../parity-types";
import { TeamDetail } from "./TeamDetail";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
function fixture() {
	let alive = true;
	const stop = mock(async () => {});
	const open = mock(
		async (_workspaceId: string, _terminalId?: string | null) => {},
	);
	const terminalList = mock(async () => ({
		sessions: alive
			? [
					{
						terminalId: "real-terminal",
						workspaceId: "workspace-b",
						name: "Worker shell",
					},
				]
			: [],
	}));
	const context = {
		hostUrl: "http://fixture.invalid",
		remote: null,
		projects: [{ id: "project-b", name: "Second project" }],
		workspaces: [
			{
				id: "workspace-b",
				projectId: "project-b",
				name: "Worker workspace",
				archivedAt: null,
			},
		],
		onOpenWorkspace: open,
		client: {
			team: {
				status: {
					query: async () => ({
						team: { id: "team", name: "Team", goal: "Goal", status: "active" },
						members: [
							{
								id: "member",
								name: "worker",
								role: "worker",
								teamId: "team",
								projectId: "project-b",
								workspaceId: "workspace-b",
								terminalId: "real-terminal",
								agentId: "codex",
								status: "active",
								taskSummary: "Task",
								deliveryState: "idle",
								binding: null,
							},
						],
					}),
				},
				stop: { mutate: stop },
			},
			mail: { timeline: { query: async () => [] } },
			terminal: { list: { query: terminalList } },
		},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
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
				<TeamDetail context={context} teamId="team" title="Team" connected />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	return {
		screen,
		stop,
		open,
		terminalList,
		exit: () => {
			alive = false;
		},
	};
}
test("member terminal opens with the exact workspace and terminal; a later exit never opens another session", async () => {
	const { screen, open, terminalList, exit } = fixture();
	const button = await screen.findByRole("button", {
		name: "Open worker terminal",
	});
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(button);
	await waitFor(() =>
		expect(open).toHaveBeenCalledWith("workspace-b", "real-terminal"),
	);
	exit();
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(button);
	await screen.findByText(
		"This terminal has exited. Refresh the team to see its current status.",
	);
	expect(open).toHaveBeenCalledTimes(1);
	expect(terminalList.mock.calls.length).toBeGreaterThanOrEqual(3);
});
test("stopping a worker requires confirmation and targets only that member", async () => {
	const { screen, stop } = fixture();
	const card = await screen.findByRole("article");
	fireEvent.keyDown(
		within(card).getByRole("button", { name: "More options" }),
		{ key: "Enter" },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Stop worker" }));
	await screen.findByRole("alertdialog");
	expect(stop).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(stop).toHaveBeenCalledWith({ teamId: "team", member: "worker" }),
	);
});
