import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { JedvParityViewContext } from "../../../../../../parity-types";
import { renderConnectionSettings } from "../../test-utils/render-settings";
import { ExtensionSettings } from "./ExtensionSettings";

const caches: ReturnType<typeof renderConnectionSettings>["cache"][] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
test("extensions use real enable/install interfaces and issued provider tokens never enter caches", async () => {
	const token = "once_provider_token_12345678901234567890";
	const enable = mock(async (_input: unknown) => ({
		extension: {},
		providerToken: { provider: {}, token },
	}));
	const context = {
		hostUrl: "http://extension.fixture",
		client: {
			team: {
				list: {
					query: async () => [{ id: "team", name: "Team", status: "active" }],
				},
			},
			peers: {
				capabilities: { query: async () => ({ protocolVersion: 1 }) },
				listProviderTokens: { query: async () => [] },
			},
			declarativeSlots: {
				capabilities: { query: async () => ({ protocolVersion: 1 }) },
				list: {
					query: async () => [
						{ manifest: { id: "ci", name: "CI", slots: [] }, enabled: false },
					],
				},
				setEnabled: { mutate: enable },
			},
		},
	} as unknown as JedvParityViewContext;
	const { screen, cache } = renderConnectionSettings(
		<ExtensionSettings {...context} />,
	);
	caches.push(cache);
	const toggle = await screen.findByRole("switch", { name: "CI" });
	expect(enable).not.toHaveBeenCalled();
	fireEvent.click(toggle);
	await waitFor(() =>
		expect(enable).toHaveBeenCalledWith({ extensionId: "ci", enabled: true }),
	);
	await screen.findByRole("dialog", { name: "Provider token" });
	expect(
		(
			screen.getByLabelText("Provider token", {
				selector: "input",
			}) as HTMLInputElement
		).value,
	).toBe(token);
	expect(
		JSON.stringify(
			cache
				.getQueryCache()
				.getAll()
				.map((query) => query.state.data),
		),
	).not.toContain(token);
	expect(cache.getMutationCache().getAll()).toHaveLength(0);
});
