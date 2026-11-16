import { expect, test } from "bun:test";
import { ForwardTokens } from "./forward-tokens";

test("private forwards use only the configured host PSK and clear it on disconnect", () => {
	const tokens = new ForwardTokens();
	tokens.setHostToken("https://a.ts.net", "host-psk");
	expect(tokens.hostTokenFor("https://a.ts.net")).toBe("host-psk");
	expect(tokens.hostTokenFor("https://b.ts.net")).toBeNull();
	tokens.setHostToken("https://a.ts.net", null);
	expect(tokens.hostTokenFor("https://a.ts.net")).toBeNull();
	tokens.setHostToken("https://a.ts.net", "other-psk");
	tokens.clearCredentials();
	expect(tokens.hostTokenFor("https://a.ts.net")).toBeNull();
});

test("coordinator tokens require the current endpoint and secret, including after private registration", () => {
	const tokens = new ForwardTokens();
	const origin = "http://127.0.0.1:43210";
	tokens.setHostToken(origin, "local-psk");
	expect(tokens.hasHostConnection(origin, [])).toBe(false);
	expect(
		tokens.hasHostConnection(origin, [{ port: 43211, secret: "local-psk" }]),
	).toBe(false);
	expect(
		tokens.hasHostConnection(origin, [{ port: 43210, secret: "changed-psk" }]),
	).toBe(false);
	expect(
		tokens.hasHostConnection(origin, [{ port: 43210, secret: "local-psk" }]),
	).toBe(true);
	expect(tokens.beginPrivateConnection(origin).commit("private-psk")).toBe(
		true,
	);
	expect(tokens.hasHostConnection(origin, [])).toBe(true);
	tokens.setHostToken(origin, "private-psk");
	expect(tokens.hasHostConnection(origin, [])).toBe(false);
	tokens.setHostToken(origin, null);
	expect(tokens.hostTokenFor(origin)).toBeNull();
});

test("revoked or superseded private attempts cannot restore credentials", () => {
	const tokens = new ForwardTokens();
	const origin = "http://127.0.0.1:43210";
	const disconnected = tokens.beginPrivateConnection(origin);
	tokens.setHostToken(origin, null);
	expect(disconnected.commit("stale-psk")).toBe(false);
	const cleared = tokens.beginPrivateConnection(origin);
	tokens.clearCredentials();
	expect(cleared.commit("stale-psk")).toBe(false);
	const first = tokens.beginPrivateConnection(origin);
	const second = tokens.beginPrivateConnection(origin);
	first.cancel();
	expect(first.commit("stale-psk")).toBe(false);
	expect(second.commit("current-psk")).toBe(true);
	expect(second.commit("reused-attempt")).toBe(false);
	expect(tokens.hostTokenFor(origin)).toBe("current-psk");
	tokens.clearCredentials();
	expect(tokens.hasHostConnection(origin, [])).toBe(false);
});
