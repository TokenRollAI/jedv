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
