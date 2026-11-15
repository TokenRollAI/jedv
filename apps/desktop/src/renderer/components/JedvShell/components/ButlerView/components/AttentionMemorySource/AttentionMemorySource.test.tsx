import { afterEach, expect, test } from "bun:test";
import type { AttentionSourceTarget } from "@jedv/shared/butler-attention";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { JedvParityViewContext } from "../../../../parity-types";
import { AttentionMemorySource } from "./AttentionMemorySource";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
test("an archived team source keeps memory read-only even after selecting global scope", async () => {
	const source: AttentionSourceTarget = {
		kind: "memory",
		teamId: "team",
		memberId: null,
		projectId: null,
		workspaceId: null,
		terminalId: null,
		terminalLive: false,
		fallback: "memory",
		mailDeliveryId: null,
		automationId: null,
		automationRunId: null,
	};
	const context = {
		hostUrl: "http://attention-memory.fixture",
		client: {
			team: {
				status: {
					query: async () => ({ team: { id: "team", status: "archived" } }),
				},
			},
			memory: {
				capabilities: { query: async () => ({ protocolVersion: 1 }) },
				list: { query: async () => [] },
			},
		},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const screen = render(
		<QueryClientProvider client={cache}>
			<AttentionMemorySource
				context={context}
				source={source}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
	const add = await screen.findByRole("button", { name: "Add memory" });
	await waitFor(() =>
		expect(
			cache.getQueryData([
				"jedv",
				context.hostUrl,
				"attention-memory-team",
				"team",
			]),
		).toEqual({ team: { id: "team", status: "archived" } }),
	);
	expect((add as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole("combobox", { name: "Memory scope" }));
	fireEvent.click(await screen.findByRole("option", { name: "Global" }));
	expect(
		(screen.getByRole("button", { name: "Add memory" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});
