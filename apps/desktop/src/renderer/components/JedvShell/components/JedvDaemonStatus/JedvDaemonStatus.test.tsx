import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { LocalClient } from "../../local-client";
import { JedvDaemonStatus } from "./JedvDaemonStatus";

afterEach(cleanup);
test("a failed session-preserving update never force restarts without a separate confirmation", async () => {
	const update = mock(async () => ({
			ok: false,
			reason: "fixture handoff refused",
		})),
		restart = mock(async () => ({ ok: true }));
	const client = {
		terminal: {
			daemon: {
				getUpdateStatus: {
					query: async () => ({
						pending: true,
						running: "fixture-old",
						expected: "fixture-new",
						autoUpdateFailure: null,
					}),
				},
				getHealth: {
					query: async () => ({ reachable: true, unreachableForMs: 0 }),
				},
				update: { mutate: update },
				restart: { mutate: restart },
			},
		},
	} as unknown as LocalClient;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={queries}>
			<JedvDaemonStatus client={client} hostUrl="http://fixture-daemon" />
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(
			view
				.getByRole("button", { name: "Update daemon" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	expect(update).not.toHaveBeenCalled();
	expect(restart).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Update daemon" }));
	await waitFor(() =>
		expect(view.getByText("fixture handoff refused")).toBeTruthy(),
	);
	expect(update).toHaveBeenCalledTimes(1);
	expect(restart).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Force restart" }));
	expect(view.getByText(/Restart does not preserve sessions/)).toBeTruthy();
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(restart).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: "Force restart" }));
	fireEvent.click(
		within(view.getByRole("alertdialog")).getByRole("button", {
			name: "Confirm",
		}),
	);
	await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
	queries.clear();
});
