import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { useTeamwork } from "../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../parity-types";
import { CreateTeamView } from "./CreateTeamView";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
function setup(available = true, startSupported = true) {
	let ended = false;
	let uncertain = false;
	const binding = {
		terminalId: "terminal",
		workspaceId: "workspace",
		agentId: "codex",
		launchId: "launch",
		agentSessionId: "native-session",
		startedAt: 1,
	};
	const workspace = {
		id: "workspace",
		name: "Workspace",
		projectId: "project",
		archivedAt: null,
	};
	const start = mock(async (_input: unknown) => {
		if (uncertain) {
			uncertain = false;
			throw new Error("disconnected");
		}
		return { team: { id: "started-team" }, members: [] };
	});
	const init = mock(async (_input: unknown) => ({
		team: { id: "created-team" },
		members: [],
	}));
	const open = mock(async (_workspaceId: string) => {}),
		created = mock((_id: string) => {});
	const context = {
		hostUrl: "http://create.fixture",
		remote: null,
		projects: [{ id: "project", name: "Project" }],
		workspaces: [workspace],
		onOpenWorkspace: open,
		onOpenCreateWorkspace: () => {},
		client: {
			terminalAgents: {
				list: { query: async () => (available && !ended ? [binding] : []) },
			},
			terminal: {
				list: {
					query: async () => ({
						sessions: [
							{ terminalId: "terminal", exited: false, title: "Real shell" },
						],
					}),
				},
			},
			workspace: { list: { query: async () => [workspace] } },
			team: {
				list: { query: async () => [] },
				init: { mutate: init },
				start: { mutate: start },
			},
			settings: {
				agentConfigs: {
					list: {
						query: async () => [
							{
								id: "codex-config",
								presetId: "codex",
								label: "Codex",
								iconId: null,
							},
						],
					},
				},
			},
		},
	} as unknown as JedvParityViewContext;
	const index = {
		membershipReady: true,
		membershipError: false,
		supported: true,
		activeSnapshots: [],
		list: { data: [], isSuccess: true, isError: false },
		capabilities: {
			data: { protocolVersion: 1, features: { start: startSupported } },
			isSuccess: true,
			isError: false,
		},
	} as unknown as ReturnType<typeof useTeamwork>;
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
				<CreateTeamView
					context={context}
					index={index}
					connected
					onCreated={created}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	return {
		screen,
		init,
		start,
		failNext: () => {
			uncertain = true;
		},
		open,
		created,
		end: () => {
			ended = true;
		},
	};
}

test("task creation defaults to a fresh leader with verbatim text and no required name or existing session", async () => {
	const { screen, start, init, created } = setup(false);
	const text = "  Preserve indentation\n    Run the task";
	fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
		target: { value: text },
	});
	const button = screen.getByRole("button", { name: "Start task" });
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(button);
	await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
	expect(start.mock.calls[0]?.[0]).toMatchObject({
		workspaceId: "workspace",
		agent: "codex-config",
		prompt: text,
		leaderName: "leader",
		name: "Preserve indentation",
	});
	expect(init).not.toHaveBeenCalled();
	await waitFor(() => expect(created).toHaveBeenCalledWith("started-team"));
});

test("inline team name derives a smart < 36 char title at word boundary and respects custom overrides", async () => {
	const { screen, start } = setup(false);
	const longPrompt =
		"Investigate and fix the authentication token refresh bug across all desktop clients";
	fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
		target: { value: longPrompt },
	});
	const nameInput = screen.getByRole("textbox", {
		name: "Team name",
	}) as HTMLInputElement;
	expect(nameInput.placeholder.length).toBeLessThan(36);
	expect(nameInput.placeholder).toMatch(/…$/);
	expect(nameInput.placeholder).toBe("Investigate and fix the…");
	const submit = screen.getByRole("button", { name: "Start task" });
	await waitFor(() =>
		expect((submit as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(submit);
	await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
	expect(start.mock.calls[0]?.[0]).toMatchObject({
		name: "Investigate and fix the…",
		prompt: longPrompt,
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
		target: { value: longPrompt },
	});
	fireEvent.change(nameInput, { target: { value: "Auth refresh fix" } });
	fireEvent.click(submit);
	await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
	expect(start.mock.calls[1]?.[0]).toMatchObject({
		name: "Auth refresh fix",
	});
});
test("uncertain task retries retain the draft, full payload and operation identity", async () => {
	const { screen, start, failNext } = setup();
	failNext();
	const text = "  Retry exactly\n unchanged";
	const input = screen.getByRole("textbox", { name: "Task" });
	fireEvent.change(input, { target: { value: text } });
	const submit = screen.getByRole("button", { name: "Start task" });
	await waitFor(() =>
		expect((submit as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(submit);
	await screen.findByText(
		"Outcome uncertain. Retry with the same task settings.",
	);
	await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(text));
	expect(
		(
			screen.getByRole("combobox", {
				name: "Select workspace",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(submit);
	await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
	expect(start.mock.calls[1]).toEqual(start.mock.calls[0]);
});
test("existing-session promotion is a secondary command dialog with fresh identity validation", async () => {
	const { screen, init, start, created } = setup();
	fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
		target: { value: "Shared goal" },
	});
	fireEvent.click(
		screen.getByRole("button", { name: "Use an existing session" }),
	);
	fireEvent.click(await screen.findByRole("option", { name: /Real shell/ }));
	fireEvent.click(screen.getByRole("button", { name: "Create team" }));
	await waitFor(() =>
		expect(init).toHaveBeenCalledWith({
			actor: {
				workspaceId: "workspace",
				terminalId: "terminal",
				launchId: "launch",
			},
			name: "Shared goal",
			goal: "Shared goal",
		}),
	);
	expect(start).not.toHaveBeenCalled();
	await waitFor(() => expect(created).toHaveBeenCalledWith("created-team"));
});
test("secondary promotion revalidates ended sessions and retains the task", async () => {
	const { screen, init, end } = setup();
	fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
		target: { value: "Keep draft" },
	});
	fireEvent.click(
		screen.getByRole("button", { name: "Use an existing session" }),
	);
	fireEvent.click(await screen.findByRole("option", { name: /Real shell/ }));
	end();
	fireEvent.click(screen.getByRole("button", { name: "Create team" }));
	await screen.findByText(
		"This session is no longer available. Choose another leader.",
	);
	expect(init).not.toHaveBeenCalled();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Task",
				hidden: true,
			}) as HTMLTextAreaElement
		).value,
	).toBe("Keep draft");
});

test("protocol 1 without the start feature keeps promotion available and blocks new-task calls", async () => {
	const { screen, start } = setup(true, false);
	fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
		target: { value: "Do work" },
	});
	await screen.findByText(
		"This host cannot start team tasks. Update the host or use an existing session.",
	);
	expect(
		(screen.getByRole("button", { name: "Start task" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		(
			screen.getByRole("button", {
				name: "Use an existing session",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
	expect(start).not.toHaveBeenCalled();
});

test("untitled existing candidate sessions format as <AgentLabel> · <workspaceName> (#id)", async () => {
	const workspace = {
		id: "workspace",
		name: "alpha-ws",
		projectId: "project",
		archivedAt: null,
	};
	const context = {
		hostUrl: "http://untitled-candidate.fixture",
		remote: null,
		projects: [{ id: "project", name: "Project" }],
		workspaces: [workspace],
		onOpenWorkspace: async () => {},
		onOpenCreateWorkspace: () => {},
		client: {
			terminalAgents: {
				list: {
					query: async () => [
						{
							terminalId: "48b443e0-1234-5678",
							workspaceId: "workspace",
							agentId: "codex",
							launchId: "launch",
							agentSessionId: "native-session",
							startedAt: 1,
						},
					],
				},
			},
			terminal: {
				list: {
					query: async () => ({
						sessions: [
							{ terminalId: "48b443e0-1234-5678", exited: false, title: "" },
						],
					}),
				},
			},
			workspace: { list: { query: async () => [workspace] } },
			team: {
				list: { query: async () => [] },
				init: {
					mutate: async () => ({
						team: { id: "created-team" },
						members: [],
					}),
				},
				start: { mutate: async () => ({ team: { id: "t" }, members: [] }) },
			},
			settings: {
				agentConfigs: {
					list: {
						query: async () => [
							{
								id: "codex-config",
								presetId: "codex",
								label: "Codex",
								iconId: null,
							},
						],
					},
				},
			},
		},
	} as unknown as JedvParityViewContext;
	const index = {
		membershipReady: true,
		membershipError: false,
		supported: true,
		activeSnapshots: [],
		list: { data: [], isSuccess: true, isError: false },
		capabilities: {
			data: { protocolVersion: 1, features: { start: true } },
			isSuccess: true,
			isError: false,
		},
	} as unknown as ReturnType<typeof useTeamwork>;
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
				<CreateTeamView
					context={context}
					index={index}
					connected
					onCreated={() => {}}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Use an existing session" }),
	);
	const option = await screen.findByRole("option", {
		name: /Codex · alpha-ws \(#48b443e0\)/,
	});
	expect(option).toBeTruthy();
});
