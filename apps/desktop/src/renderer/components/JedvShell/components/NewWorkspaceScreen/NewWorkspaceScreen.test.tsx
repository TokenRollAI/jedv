import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ProjectActionContext } from "../JedvProjectActions";
import { NewWorkspaceScreen } from "./NewWorkspaceScreen";

const preferenceKey = "lastSelectedV2WorkspaceCreateAgent";
let previousPreference: string | null;
beforeEach(() => {
	previousPreference = localStorage.getItem(preferenceKey);
	localStorage.removeItem(preferenceKey);
});
afterEach(() => {
	cleanup();
	if (previousPreference === null) localStorage.removeItem(preferenceKey);
	else localStorage.setItem(preferenceKey, previousPreference);
});
function fixture(create: (input: unknown) => Promise<unknown>) {
	const mutate = mock(create);
	const opened = mock(async (_value: unknown) => {});
	const closed = mock(() => {});
	const refresh = mock(async () => {});
	const wait = mock(async () => true);
	const context = {
		hostUrl: "http://fixture.invalid",
		hostLabel: "Local fixture",
		isRemote: false,
		client: {
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
			workspaceCreation: {
				searchBranches: {
					query: async () => ({
						items: [],
						defaultBranch: "main",
						nextCursor: null,
					}),
				},
			},
			workspaces: { create: { mutate } },
		},
	} as unknown as ProjectActionContext;
	const screen = render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<NewWorkspaceScreen
				context={context}
				projects={[{ id: "project", name: "Fixture" }]}
				readWaitForSetup={wait}
				onCreated={opened}
				onRefresh={refresh}
				onClose={closed}
			/>
		</QueryClientProvider>,
	);
	const editor = screen.getByRole("textbox", {
		name: "What do you want to do?",
	});
	return { screen, editor, mutate, opened, closed, wait, refresh };
}
const successful = {
	workspace: { id: "created" },
	terminals: [{ terminalId: "setup-terminal" }],
	agents: [{ ok: true, kind: "terminal", sessionId: "agent-terminal" }],
};

test("one prompt creates and names a workspace and opens its agent, without tracked setup", async () => {
	let finish!: (value: unknown) => void;
	const f = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await waitFor(() =>
		expect(
			f.screen
				.getByRole("button", { name: "Create workspace" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.change(f.editor, { target: { value: "Fix the settings crash" } });
	fireEvent.keyDown(f.editor, { key: "Enter" });
	fireEvent.keyDown(f.editor, { key: "Enter" });
	await waitFor(() => expect(f.mutate).toHaveBeenCalledTimes(1));
	expect(f.mutate.mock.calls[0]?.[0]).toMatchObject({
		projectId: "project",
		checkout: "worktree",
		baseBranch: "main",
		waitForSetupBeforeAgents: true,
		agents: [
			{
				agent: "codex-config",
				prompt: "Fix the settings crash",
				surface: "terminal",
			},
		],
	});
	expect(f.mutate.mock.calls[0]?.[0]).not.toHaveProperty(
		"trackSetupCompletion",
	);
	expect(f.mutate.mock.calls[0]?.[0]).not.toHaveProperty("name");
	finish(successful);
	await waitFor(() => expect(f.opened).toHaveBeenCalledTimes(1));
	expect(f.opened.mock.calls[0]?.[0]).toMatchObject({
		workspaceId: "created",
		terminalId: "agent-terminal",
	});
});

test("unknown create outcome retains prompt and replays the exact request ID", async () => {
	let calls = 0;
	const f = fixture(async () => {
		if (++calls === 1) throw new Error("connection interrupted");
		return { ...successful, agents: [], alreadyExists: true };
	});
	await waitFor(() =>
		expect(
			f.screen
				.getByRole("button", { name: "Create workspace" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.change(f.editor, { target: { value: "Keep this request" } });
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() =>
		expect(f.screen.getByRole("alert").textContent).toContain(
			"connection interrupted",
		),
	);
	expect((f.editor as HTMLTextAreaElement).value).toBe("Keep this request");
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() =>
		expect(
			f.screen.getByRole("button", { name: "Open workspace" }),
		).toBeTruthy(),
	);
	expect(f.mutate.mock.calls[1]?.[0]).toEqual(f.mutate.mock.calls[0]?.[0]);
	expect(f.opened).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: "Open workspace" }));
	await waitFor(() => expect(f.opened).toHaveBeenCalledTimes(1));
	expect(f.mutate).toHaveBeenCalledTimes(2);
});

test("partial launch failure keeps the created workspace and never submits the prompt again", async () => {
	const f = fixture(async () => ({
		...successful,
		agents: [{ ok: false, error: "Agent executable unavailable" }],
	}));
	await waitFor(() =>
		expect(
			f.screen
				.getByRole("button", { name: "Create workspace" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.change(f.editor, { target: { value: "Test launch" } });
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() =>
		expect(f.screen.getByRole("alert").textContent).toContain(
			"Agent executable unavailable",
		),
	);
	expect((f.editor as HTMLTextAreaElement).value).toBe("Test launch");
	fireEvent.click(f.screen.getByRole("button", { name: "Open workspace" }));
	await waitFor(() => expect(f.opened).toHaveBeenCalledTimes(1));
	expect(f.mutate).toHaveBeenCalledTimes(1);
});

test("empty submit creates an empty workspace without launching an agent", async () => {
	const f = fixture(async () => ({ ...successful, agents: [] }));
	await waitFor(() =>
		expect(
			f.screen
				.getByRole("button", { name: "Create workspace" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() => expect(f.mutate).toHaveBeenCalledTimes(1));
	expect(f.mutate.mock.calls[0]?.[0]).not.toHaveProperty("agents");
	expect(f.wait).not.toHaveBeenCalled();
});

test("schema rejection unlocks the draft for correction without losing its prompt", async () => {
	const f = fixture(async () => {
		throw Object.assign(new Error("Invalid launch options"), {
			data: { code: "BAD_REQUEST" },
		});
	});
	await waitFor(() =>
		expect(
			f.screen
				.getByRole("button", { name: "Create workspace" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.change(f.editor, { target: { value: "Fix this request" } });
	fireEvent.click(f.screen.getByRole("button", { name: "Create workspace" }));
	await waitFor(() =>
		expect(f.screen.getByRole("alert").textContent).toContain(
			"Invalid launch options",
		),
	);
	expect((f.editor as HTMLTextAreaElement).disabled).toBe(false);
	expect((f.editor as HTMLTextAreaElement).value).toBe("Fix this request");
});
