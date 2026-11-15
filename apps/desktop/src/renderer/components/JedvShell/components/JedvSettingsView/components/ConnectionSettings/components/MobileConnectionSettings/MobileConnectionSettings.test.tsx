import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { JedvParityViewContext } from "../../../../../../parity-types";
import { renderConnectionSettings } from "../../test-utils/render-settings";
import { MobileConnectionSettings } from "./MobileConnectionSettings";

const caches: ReturnType<typeof renderConnectionSettings>["cache"][] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
function setup() {
	let origin: string | null = null;
	const setOrigin = mock(async (input: { origin: string | null }) => {
		origin = input.origin;
		return {
			origin,
			mobileUrl: origin ? `${origin}/mobile` : null,
			revokedSessions: true,
		};
	});
	const createPairingCode = mock(async () => ({
		code: "ONCE-5678",
		expiresAt: Date.now() + 300_000,
	}));
	const context = {
		hostUrl: "http://mobile.fixture",
		remote: null,
		client: {
			mobileAuth: {
				capabilities: { query: async () => ({ protocolVersion: 1 }) },
				getOrigin: {
					query: async () => ({
						origin,
						mobileUrl: origin ? `${origin}/mobile` : null,
					}),
				},
				listSessions: { query: async () => [] },
				setOrigin: { mutate: setOrigin },
				createPairingCode: { mutate: createPairingCode },
			},
		},
	} as unknown as JedvParityViewContext;
	const result = renderConnectionSettings(
		<MobileConnectionSettings {...context} />,
	);
	caches.push(result.cache);
	return { ...result, setOrigin, createPairingCode };
}
test("mobile address validates the private HTTPS origin and confirms session revocation before saving", async () => {
	const { screen, setOrigin } = setup();
	const input = await screen.findByRole("textbox", {
		name: "Mobile access address",
	});
	await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
	fireEvent.change(input, { target: { value: "https://public.example" } });
	expect(
		(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.change(input, { target: { value: "https://host.fixture.ts.net" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	expect(setOrigin).not.toHaveBeenCalled();
	await screen.findByRole("alertdialog");
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(setOrigin).toHaveBeenCalledWith({
			origin: "https://host.fixture.ts.net",
		}),
	);
	await screen.findByRole("button", {
		name: "https://host.fixture.ts.net/mobile",
	});
	fireEvent.click(screen.getByRole("button", { name: "Clear" }));
	expect(setOrigin).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(setOrigin).toHaveBeenLastCalledWith({ origin: null }),
	);
});
test("pairing codes are explicit issuance and remain outside query and mutation caches", async () => {
	const { screen, setOrigin, createPairingCode, cache } = setup();
	const input = await screen.findByRole("textbox", {
		name: "Mobile access address",
	});
	await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
	expect(createPairingCode).not.toHaveBeenCalled();
	fireEvent.change(input, { target: { value: "https://host.fixture.ts.net" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(setOrigin).toHaveBeenCalledTimes(1));
	const pair = screen.getByRole("button", { name: "Pair device" });
	await waitFor(() => expect((pair as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(pair);
	await screen.findByText("ONCE-5678");
	expect(createPairingCode).toHaveBeenCalledTimes(1);
	expect(
		JSON.stringify(
			cache
				.getQueryCache()
				.getAll()
				.map((query) => query.state.data),
		),
	).not.toContain("ONCE-5678");
	expect(cache.getMutationCache().getAll()).toHaveLength(0);
});
