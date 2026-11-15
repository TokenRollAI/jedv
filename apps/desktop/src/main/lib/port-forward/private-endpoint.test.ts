import { expect, test } from "bun:test";
import {
	normalizePrivateEndpoint,
	validatePrivateHostToken,
} from "./private-endpoint";

test("private hosts accept Tailscale HTTPS origins and local loopback", () => {
	expect(normalizePrivateEndpoint("https://worker.tailnet.ts.net/")).toBe(
		"https://worker.tailnet.ts.net",
	);
	expect(normalizePrivateEndpoint("http://127.0.0.1:5555")).toBe(
		"http://127.0.0.1:5555",
	);
});
test("private hosts reject public origins, credentials, paths and plaintext private networks", () => {
	for (const value of [
		"https://example.com",
		"http://worker.tailnet.ts.net",
		"http://192.168.1.2:5555",
		"https://worker.ts.net/path",
		"https://psk@worker.ts.net",
		"https://worker.ts.net?token=psk",
		"https://worker.ts.net#psk",
		"http://0.0.0.0:5555",
		"http://localhost:5555",
		"http://[::1]:5555",
	])
		expect(() => normalizePrivateEndpoint(value)).toThrow();
});
test("PSK cannot be empty or inject headers", () => {
	expect(validatePrivateHostToken("host-secret")).toBe("host-secret");
	for (const token of ["", "secret\nHeader:x", "two words"])
		expect(() => validatePrivateHostToken(token)).toThrow();
});
