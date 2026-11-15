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
import type { LocalClient } from "../../local-client";
import { WorkspaceForwards } from "./WorkspaceForwards";

afterEach(cleanup);
test("discovered local ports require real confirmation before a fixture kill and surface a failed result", async () => {
	const kill = mock(async () => ({
		success: false,
		error: "fixture permission denied",
	}));
	const client = {
		ports: {
			getAll: {
				query: async () => [
					{
						port: 3000,
						terminalId: "t",
						workspaceId: "w",
						label: "Dev",
						processName: "fixture",
						pid: 123,
						protocol: "tcp",
					},
				],
			},
			kill: { mutate: kill },
		},
	} as unknown as LocalClient;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: [] } });
					emit.complete();
				}),
		],
	});
	const view = render(
		<QueryClientProvider client={queries}>
			<electronTrpc.Provider client={ipc} queryClient={queries}>
				<WorkspaceForwards
					client={client}
					hostUrl="http://ports-fixture"
					workspaceId="w"
					remote={false}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	fireEvent.click(await view.findByRole("button", { name: "Ports" }));
	await waitFor(() =>
		expect(view.getByRole("button", { name: "Close port 3000" })).toBeTruthy(),
	);
	fireEvent.click(view.getByRole("button", { name: "Close port 3000" }));
	expect(kill).not.toHaveBeenCalled();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(kill).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Close port 3000" }));
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Confirm",
		}),
	);
	await waitFor(() =>
		expect(kill).toHaveBeenCalledWith({
			workspaceId: "w",
			terminalId: "t",
			port: 3000,
		}),
	);
	await waitFor(() =>
		expect(view.getByText("fixture permission denied")).toBeTruthy(),
	);
	queries.clear();
});
