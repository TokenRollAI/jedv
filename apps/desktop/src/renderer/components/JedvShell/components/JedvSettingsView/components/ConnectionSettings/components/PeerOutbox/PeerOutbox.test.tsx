import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { JedvParityViewContext } from "../../../../../../parity-types";
import { renderConnectionSettings } from "../../test-utils/render-settings";
import { PeerOutbox } from "./PeerOutbox";

const caches: ReturnType<typeof renderConnectionSettings>["cache"][] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
test("dead letters retry only on confirmation and lock after an uncertain outcome until manual refresh", async () => {
	const row = {
		id: "dead-id",
		targetPeerId: "remote",
		remoteTeamId: "team",
		remoteTo: "leader",
		status: "dead",
		attemptCount: 2,
	};
	const retry = mock(async (_input: unknown) => {
		throw new Error("transport");
	});
	const context = {
		hostUrl: "http://outbox.fixture",
		client: {
			peers: {
				outbox: { query: async () => [row] },
				retryDeadOutbox: { mutate: retry },
			},
		},
	} as unknown as JedvParityViewContext;
	const { screen, cache } = renderConnectionSettings(
		<PeerOutbox context={context} onClose={() => {}} />,
	);
	caches.push(cache);
	const button = await screen.findByRole("button", { name: "Retry" });
	expect(retry).not.toHaveBeenCalled();
	fireEvent.click(button);
	expect(retry).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(retry).toHaveBeenCalledWith({ outboxId: "dead-id" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect((button as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(false),
	);
	expect(retry).toHaveBeenCalledTimes(1);
});
