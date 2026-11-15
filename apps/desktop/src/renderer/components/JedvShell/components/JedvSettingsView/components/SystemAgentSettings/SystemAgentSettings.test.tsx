import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { LocalClient } from "../../../../local-client";
import { SystemAgentSettings } from "./SystemAgentSettings";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
test("settings never refill a stored key; saving stores only the masked status in query cache", async () => {
	const save = mock(async (_input: unknown) => ({
		configured: true,
		maskedHint: "••••1234",
	}));
	const client = {
		aiSettings: {
			get: {
				query: async () => ({ configured: true, maskedHint: "••••old1" }),
			},
			setDeepseekKey: { mutate: save },
		},
	} as unknown as LocalClient;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const screen = render(
		<QueryClientProvider client={cache}>
			<SystemAgentSettings client={client} hostUrl="http://key.fixture" />
		</QueryClientProvider>,
	);
	await screen.findByText("Configured · ••••old1");
	const input = screen.getByLabelText("DeepSeek API Key") as HTMLInputElement;
	expect(input.type).toBe("password");
	expect(input.value).toBe("");
	const secret = "test-secret-key-1234";
	fireEvent.change(input, { target: { value: secret } });
	const form = input.closest("form");
	if (!form) throw new Error("DeepSeek key input has no settings form");
	fireEvent.submit(form);
	await waitFor(() => expect(save).toHaveBeenCalledWith({ apiKey: secret }));
	await screen.findByText("Configured · ••••1234");
	expect(input.value).toBe("");
	expect(
		JSON.stringify(
			cache
				.getQueryCache()
				.getAll()
				.map((query) => query.state.data),
		),
	).not.toContain(secret);
	expect(cache.getMutationCache().getAll()).toHaveLength(0);
	fireEvent.click(screen.getByRole("button", { name: "Clear API key" }));
	expect(save).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(save).toHaveBeenLastCalledWith({ apiKey: null }));
});
