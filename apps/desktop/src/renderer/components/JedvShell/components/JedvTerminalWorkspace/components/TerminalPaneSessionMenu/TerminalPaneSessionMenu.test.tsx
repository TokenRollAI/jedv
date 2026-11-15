import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { RendererContext } from "@jedv/panes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { TerminalSession } from "../../../../types";
import type {
	SessionBinding,
	TerminalSessionsMenuProps,
} from "../../../JedvTerminalTabStrip/types";
import {
	attachTerminalSession,
	backgroundTerminalSessions,
	createTerminalWorkspaceStore,
	paneTerminalId,
	type WorkspacePaneData,
	workspacePaneAreas,
} from "../../layout";
import { TerminalPaneSessionMenu } from "./TerminalPaneSessionMenu";

afterEach(cleanup);
function fixture() {
	const sessions = ["a", "b", "c", "right"].map((terminalId, index) => ({
		terminalId,
		workspaceId: "w",
		title: terminalId,
		customTitle: null,
		createdAt: 1000 - index,
		exited: false,
		exitCode: 0,
	})) as TerminalSession[];
	const store = createTerminalWorkspaceStore();
	attachTerminalSession(store, sessions[0]);
	attachTerminalSession(store, sessions[1]);
	store.getState().movePaneToSplit({
		sourcePaneId: "b",
		targetPaneId: "a",
		position: "right",
	});
	const right = workspacePaneAreas(store).right;
	attachTerminalSession(right, sessions[3]);
	store.getState().focusPane("a");
	const found = store.getState().getPane("b");
	const tab = found && store.getState().getTab(found.tabId);
	if (!found || !tab) throw new Error("Fixture pane missing");
	const context: RendererContext<WorkspacePaneData> = {
		store,
		pane: { ...found.pane, parentDirection: "horizontal" },
		tab: { ...tab, position: 0 },
		isActive: false,
		headerActions: null,
		actions: {
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			pin: () => {},
			updateData: () => {},
			split: () => {},
		},
	};
	let next = "new";
	const create = mock(async () => {
		sessions.push({ ...sessions[0], terminalId: next, title: next });
		return { terminalId: next, status: "active" as const };
	});
	const attach = mock((_id: string) => {});
	const props = {
		store,
		sessions,
		activeId: "a",
		enabled: true,
		connected: true,
		configs: [],
		onNew: () => {},
		onAttach: attach,
		onKill: () => {},
		onLaunch: () => {},
		onSettings: () => {},
		sessionPicker: {
			hostUrl: "http://fixture",
			workspaceId: "w",
			onSelectSession: async () => {},
			client: {
				terminal: {
					list: { query: async () => ({ sessions }) },
					createSession: { mutate: create },
				},
				terminalAgents: {
					listByWorkspace: { query: async () => [] },
					resumeCandidates: { query: async () => [] },
				},
			},
		},
	} as unknown as TerminalSessionsMenuProps;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = (displayAgentId?: string | null) => (
		<QueryClientProvider client={cache}>
			<TerminalPaneSessionMenu
				context={context}
				menuProps={props}
				displayAgentId={displayAgentId}
				onCreated={async () => {}}
			/>
		</QueryClientProvider>
	);
	return {
		store,
		right,
		sessions,
		cache,
		context,
		props,
		create,
		attach,
		view,
		setNext: (value: string) => {
			next = value;
		},
	};
}

test("a nonactive split pane switches and creates its own session while both areas' shown sessions stay protected", async () => {
	const title = spyOn(terminalRuntimeRegistry, "getTitle").mockReturnValue(
		undefined,
	);
	const subscribe = spyOn(
		terminalRuntimeRegistry,
		"onTitleChange",
	).mockReturnValue(() => {});
	const f = fixture();
	try {
		const screen = render(f.view());
		fireEvent.keyDown(screen.getByRole("button", { name: "b" }), {
			key: "Enter",
		});
		const other = await screen.findByRole("menuitem", { name: /a Attached/ });
		expect(other.getAttribute("data-disabled")).not.toBeNull();
		expect(
			screen
				.getByRole("menuitem", { name: /right Attached/ })
				.getAttribute("data-disabled"),
		).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Kill b" })).toBeNull();
		fireEvent.click(screen.getByRole("menuitem", { name: /c Detached/ }));
		await waitFor(() =>
			expect(paneTerminalId(f.store.getState().getPane("b")?.pane)).toBe("c"),
		);
		expect(paneTerminalId(f.store.getState().getPane("a")?.pane)).toBe("a");
		expect(
			backgroundTerminalSessions(f.store, f.sessions).map((s) => s.terminalId),
		).toContain("b");
		act(() => f.store.getState().focusPane("a"));
		fireEvent.keyDown(screen.getByRole("button", { name: "c" }), {
			key: "Enter",
		});
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "New Terminal" }),
		);
		await waitFor(() =>
			expect(paneTerminalId(f.store.getState().getPane("b")?.pane)).toBe("new"),
		);
		expect(paneTerminalId(f.store.getState().getPane("a")?.pane)).toBe("a");
		expect(f.store.getState().tabs).toHaveLength(1);
		expect(
			backgroundTerminalSessions(f.store, f.sessions).map((s) => s.terminalId),
		).toContain("c");
		let resolve!: (value: { terminalId: string; status: "active" }) => void;
		f.create.mockImplementationOnce(
			() =>
				new Promise<{ terminalId: string; status: "active" }>((done) => {
					resolve = done;
				}),
		);
		act(() => f.store.getState().focusPane("a"));
		fireEvent.keyDown(screen.getByRole("button", { name: "new" }), {
			key: "Enter",
		});
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "New Terminal" }),
		);
		await waitFor(() => expect(f.create).toHaveBeenCalledTimes(2));
		act(() =>
			f.store
				.getState()
				.setPaneData({ paneId: "b", data: { terminalId: "changed" } }),
		);
		await act(async () => {
			f.sessions.push({ ...f.sessions[0], terminalId: "late", title: "late" });
			resolve({ terminalId: "late", status: "active" });
		});
		expect(paneTerminalId(f.store.getState().getPane("b")?.pane)).toBe(
			"changed",
		);
		expect(f.attach).not.toHaveBeenCalledWith("late");
	} finally {
		cleanup();
		f.cache.clear();
		title.mockRestore();
		subscribe.mockRestore();
	}
});

test("a pane title subscribes to live runtime changes and follows HEAD override, custom-name and agent precedence", async () => {
	let runtime: string | undefined = "zsh";
	let listener = () => {};
	const title = spyOn(terminalRuntimeRegistry, "getTitle").mockImplementation(
		() => runtime,
	);
	const subscribe = spyOn(
		terminalRuntimeRegistry,
		"onTitleChange",
	).mockImplementation((_id, cb) => {
		listener = cb;
		return () => {};
	});
	const f = fixture();
	try {
		const screen = render(f.view());
		expect(screen.getByRole("button", { name: "zsh" })).toBeTruthy();
		act(() => {
			runtime = "Build running";
			listener();
		});
		expect(screen.getByRole("button", { name: "Build running" })).toBeTruthy();
		screen.rerender(f.view("claude"));
		expect(await screen.findByRole("button", { name: "Claude" })).toBeTruthy();
		act(() => {
			runtime = "Named session";
			listener();
			f.cache.setQueryData(["jedv", "http://fixture", "terminals", "w"], {
				sessions: f.sessions.map((s) =>
					s.terminalId === "b"
						? { ...s, customTitle: "Named session", title: "Named session" }
						: s,
				),
			});
		});
		expect(
			await screen.findByRole("button", { name: "Named session" }),
		).toBeTruthy();
		act(() =>
			f.store.getState().setPaneTitleOverride({
				tabId: f.context.tab.id,
				paneId: "b",
				titleOverride: "Preset label",
			}),
		);
		expect(screen.getByRole("button", { name: "Preset label" })).toBeTruthy();
	} finally {
		cleanup();
		f.cache.clear();
		title.mockRestore();
		subscribe.mockRestore();
	}
});

test("closed pane identities use the live parent projection before any menu request and ignore a stale menu binding after removal", async () => {
	const title = spyOn(terminalRuntimeRegistry, "getTitle").mockImplementation(
		(id) => `${id} shell`,
	);
	const subscribe = spyOn(
		terminalRuntimeRegistry,
		"onTitleChange",
	).mockReturnValue(() => {});
	const f = fixture();
	const bindings = [
		{ terminalId: "b", agentId: "claude", endedAt: null },
	] as unknown as SessionBinding[];
	const picker = f.props.sessionPicker;
	if (!picker) throw new Error("Fixture session picker missing");
	const query = spyOn(
		picker.client.terminalAgents.listByWorkspace,
		"query",
	).mockResolvedValue(bindings);
	const paneA = f.store.getState().getPane("a");
	if (!paneA) throw new Error("Other fixture pane missing");
	const other: RendererContext<WorkspacePaneData> = {
		...f.context,
		pane: { ...paneA.pane, parentDirection: "horizontal" },
	};
	const view = (b: string | null | undefined, a: string | null) => (
		<QueryClientProvider client={f.cache}>
			<TerminalPaneSessionMenu
				context={f.context}
				menuProps={f.props}
				displayAgentId={b}
				onCreated={async () => {}}
			/>
			<TerminalPaneSessionMenu
				context={other}
				menuProps={f.props}
				displayAgentId={a}
				onCreated={async () => {}}
			/>
		</QueryClientProvider>
	);
	const key = ["jedv", "http://fixture", "w", "native-bindings"];
	try {
		const screen = render(view("claude", null));
		expect(f.cache.getQueryData(key)).toBeUndefined();
		expect(query).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Claude" }).querySelector("img"),
		).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "a shell" }).querySelector("img"),
		).toBeNull();
		fireEvent.keyDown(screen.getByRole("button", { name: "Claude" }), {
			key: "Enter",
		});
		await waitFor(() => expect(f.cache.getQueryData(key)).toEqual(bindings));
		fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		screen.rerender(view(null, "codex"));
		expect(f.cache.getQueryData(key)).toEqual(bindings);
		expect(
			screen.getByRole("button", { name: "b shell" }).querySelector("img"),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Codex" }).querySelector("img"),
		).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Claude" })).toBeNull();
		fireEvent.keyDown(screen.getByRole("button", { name: "b shell" }), {
			key: "Enter",
		});
		expect(await screen.findByRole("button", { name: "Claude" })).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		expect(screen.getByRole("button", { name: "b shell" })).toBeTruthy();
		screen.rerender(view(undefined, "codex"));
		expect(screen.getByRole("button", { name: "b shell" })).toBeTruthy();
		expect(query).toHaveBeenCalledTimes(2);
	} finally {
		cleanup();
		f.cache.clear();
		query.mockRestore();
		title.mockRestore();
		subscribe.mockRestore();
	}
});
