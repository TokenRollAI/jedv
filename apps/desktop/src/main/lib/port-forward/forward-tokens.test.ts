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
