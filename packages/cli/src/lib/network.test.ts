import { afterEach, expect, test } from "bun:test";
import { withLocalHostService } from "./host/test-helpers";
import { networkClient } from "./network";

let protocol = 1;
withLocalHostService("network-cli-test", {
	"peers.capabilities": () => ({ protocolVersion: protocol }),
});
const ctx = { config: { organizationId: "network-cli-test" } };
afterEach(() => {
	protocol = 1;
});
test("new management commands verify their own feature instead of assuming a recent Team protocol", async () => {
	expect(await networkClient(ctx, { local: true }, "peers")).toBeTruthy();
	await expect(
		networkClient(ctx, { local: true }, "mobileAuth"),
	).rejects.toThrow("unsupported by this host");
	await expect(
		networkClient(ctx, { local: true }, "declarativeSlots"),
	).rejects.toThrow("unsupported by this host");
});
test("unknown peer management protocol is refused", async () => {
	protocol = 2;
	await expect(networkClient(ctx, { local: true }, "peers")).rejects.toThrow(
		"Unsupported host protocol",
	);
});
