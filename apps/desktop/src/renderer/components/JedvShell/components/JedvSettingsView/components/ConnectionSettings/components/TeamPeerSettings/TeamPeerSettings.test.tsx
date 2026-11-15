import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { JedvParityViewContext } from "../../../../../../parity-types";
import { renderConnectionSettings } from "../../test-utils/render-settings";
import { TeamPeerSettings } from "./TeamPeerSettings";

const caches: ReturnType<typeof renderConnectionSettings>["cache"][] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
test("peer creation uses a narrow outbound token and shows issued inbound credentials only once", async () => {
	const inbound = "issued_inbound_token_12345678901234567890",
		outbound = "remote_outbound_token_12345678901234567890";
	const upsert = mock(async (_input: unknown) => ({
		peer: { id: "remote" },
		inboundToken: inbound,
	}));
	const context = {
		hostUrl: "http://peer.fixture",
		client: {
			peers: {
				capabilities: { query: async () => ({ protocolVersion: 1 }) },
				list: { query: async () => ({ localHostId: "this-host", items: [] }) },
				outbox: { query: async () => [] },
				upsert: { mutate: upsert },
			},
		},
	} as unknown as JedvParityViewContext;
	const { screen, cache } = renderConnectionSettings(
		<TeamPeerSettings {...context} />,
	);
	caches.push(cache);
	const add = screen.getByRole("button", { name: "Add peer" });
	await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(add);
	fireEvent.change(screen.getByRole("textbox", { name: "Peer host ID" }), {
		target: { value: "remote" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
		target: { value: "Builder" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "HTTPS address" }), {
		target: { value: "https://build.fixture.ts.net" },
	});
	fireEvent.change(screen.getByLabelText("Outbound mail token"), {
		target: { value: outbound },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(upsert).toHaveBeenCalledWith({
			id: "remote",
			name: "Builder",
			origin: "https://build.fixture.ts.net",
			outboundToken: outbound,
			enabled: true,
		}),
	);
	await screen.findByRole("dialog", { name: "Inbound mail token" });
	expect(
		(
			screen.getByLabelText("Inbound mail token", {
				selector: "input",
			}) as HTMLInputElement
		).value,
	).toBe(inbound);
	const cached = JSON.stringify(
		cache
			.getQueryCache()
			.getAll()
			.map((query) => query.state.data),
	);
	expect(cached).not.toContain(inbound);
	expect(cached).not.toContain(outbound);
	expect(cache.getMutationCache().getAll()).toHaveLength(0);
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	expect(
		screen.queryByLabelText("Inbound mail token", { selector: "input" }),
	).toBeNull();
});
