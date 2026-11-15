import { expect, test } from "bun:test";
import { isLoopbackBrowserUrl } from "./browser-links";

test("loopback link detection includes URL-normalized IPv4 and IPv6 forms", () => {
	for (const url of [
		"http://localhost.:3000",
		"http://preview.localhost",
		"http://127.1:3000",
		"http://2130706433",
		"http://[0:0:0:0:0:0:0:1]:3000",
		"http://0.0.0.0:3000",
	])
		expect(isLoopbackBrowserUrl(url)).toBe(true);
	expect(isLoopbackBrowserUrl("https://example.com/localhost")).toBe(false);
});
