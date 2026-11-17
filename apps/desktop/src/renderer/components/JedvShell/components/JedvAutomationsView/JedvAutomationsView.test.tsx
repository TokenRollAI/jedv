import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { JedvParityViewContext } from "../../parity-types";
import { JedvAutomationsView } from "./JedvAutomationsView";

afterEach(cleanup);
test("automation list never dispatches a run before the user clicks Run now", async () => {
	const automation = {
		id: "automation-fixture",
		name: "Fixture automation",
		prompt: "Fixture only",
		agent: "codex",
		target: { kind: "workspace", workspaceId: "fixture-workspace" },
		enabled: false,
		rrule: null,
		timezone: "UTC",
		createdAt: 1,
		updatedAt: 1,
		nextRunAt: null,
	};
	const runNow = mock(async () => ({ id: "fixture-run" }));
	const context = {
		hostUrl: "http://fixture.invalid",
		remote: null,
		projects: [],
		workspaces: [],
		onOpenWorkspace: mock(async () => {}),
		onOpenCreateWorkspace: mock(() => {}),
		client: {
			automations: {
				list: { query: async () => [automation] },
				runNow: { mutate: runNow },
				listRuns: { query: async () => [] },
			},
		},
	} as unknown as JedvParityViewContext;
	const queries = new QueryClient({
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
		<QueryClientProvider client={queries}>
			<electronTrpc.Provider client={ipc} queryClient={queries}>
				<JedvAutomationsView {...context} />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(screen.getByText("Fixture automation")).toBeTruthy(),
	);
	expect(runNow).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Run now" }));
	await waitFor(() =>
		expect(runNow).toHaveBeenCalledWith({ id: "automation-fixture" }),
	);
	await waitFor(() => expect(screen.getByText("No runs yet")).toBeTruthy());
	queries.clear();
});

test("new automation defaults to active, hides Settings tab pill, gates target validation, and falls back blank title to Untitled automation", async () => {
	const create = mock(async (input: Record<string, unknown>) => ({
		id: "created-1",
		...input,
		createdAt: 1,
		updatedAt: 1,
		nextRunAt: null,
	}));
	const listQuery = mock(async () => []);
	const baseContext = {
		hostUrl: "http://new-auto.invalid",
		remote: null,
		projects: [],
		workspaces: [],
		onOpenWorkspace: mock(async () => {}),
		onOpenCreateWorkspace: mock(() => {}),
		client: {
			automations: {
				list: { query: listQuery },
				create: { mutate: create },
			},
		},
	} as unknown as JedvParityViewContext;
	const queries = new QueryClient({
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
		<QueryClientProvider client={queries}>
			<electronTrpc.Provider client={ipc} queryClient={queries}>
				<JedvAutomationsView {...baseContext} />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(screen.getByText("No automations yet")).toBeTruthy(),
	);
	const newBtn = screen.getAllByRole("button", { name: "New automation" })[0];
	if (!newBtn) throw new Error("Missing New automation button");
	fireEvent.click(newBtn);
	expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
	expect(screen.getByText("Trigger")).toBeTruthy();
	expect(screen.getByText("Target workspace")).toBeTruthy();
	const toggle = screen.getByRole("switch");
	expect(toggle.getAttribute("aria-checked")).toBe("true");
	expect(
		screen.queryByText("Choose an available project or workspace"),
	).toBeNull();

	fireEvent.change(screen.getByLabelText("Instructions"), {
		target: { value: "Summarize status" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			screen.getAllByText("Choose an available project or workspace").length,
		).toBeGreaterThan(0),
	);
	expect(create).not.toHaveBeenCalled();

	screen.rerender(
		<QueryClientProvider client={queries}>
			<electronTrpc.Provider client={ipc} queryClient={queries}>
				<JedvAutomationsView
					{...baseContext}
					projects={[{ id: "proj-1", name: "Alpha" }] as never}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Back to automations" }));
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(
			screen.getAllByRole("button", { name: "New automation" }).length,
		).toBeGreaterThan(0),
	);
	const secondNewBtn = screen.getAllByRole("button", {
		name: "New automation",
	})[0];
	if (!secondNewBtn) throw new Error("Missing New automation button");
	fireEvent.click(secondNewBtn);
	fireEvent.change(screen.getByLabelText("Instructions"), {
		target: { value: "Run nightly check" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
	expect(create.mock.calls[0]?.[0]).toMatchObject({
		name: "Untitled automation",
		prompt: "Run nightly check",
		enabled: true,
		target: { kind: "project", projectId: "proj-1" },
	});
	queries.clear();
});
