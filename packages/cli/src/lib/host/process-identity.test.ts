import { describe, expect, test } from "bun:test";
import {
	inspectProcessCommand,
	looksLikeHostProcess,
} from "./process-identity";

describe("inspectProcessCommand", () => {
	test("reads the command line of a live pid", async () => {
		const command = await inspectProcessCommand(process.pid);
		expect(command).not.toBeNull();
		// This is the test runner itself, never the host binary.
		expect(looksLikeHostProcess(command ?? "")).toBe(false);
	});

	test("returns null for a pid that isn't running", async () => {
		// High pid unlikely to be in use; process.kill(pid, 0) semantics apply
		// the same way ps does — an absent pid yields no output.
		const command = await inspectProcessCommand(999_999);
		expect(command).toBeNull();
	});
});

describe("looksLikeHostProcess", () => {
	test("matches a command that runs the host binary", () => {
		expect(looksLikeHostProcess("/opt/jedv/bin/jedv-host")).toBe(true);
	});

	test.each([
		"/opt/jedv/lib/node /opt/jedv/lib/host-service.js",
		"/opt/jedv/bin/../lib/node /opt/jedv/bin/../lib/host-service.js",
	])("matches the standalone wrapper after exec: %s", (command) => {
		expect(looksLikeHostProcess(command, "/opt/jedv/bin/jedv-host")).toBe(true);
	});

	test("matches a standalone installation path containing spaces", () => {
		expect(
			looksLikeHostProcess(
				"/opt/Jedv App/lib/node /opt/Jedv App/lib/host-service.js",
				"/opt/Jedv App/bin/jedv-host",
			),
		).toBe(true);
	});

	test.each([
		"/usr/bin/node /tmp/server.js",
		"/usr/bin/node /tmp/host-service.js",
		"/opt/jedv/lib/node /tmp/host-service.js",
		"/opt/jedv/lib/node /opt/jedv/lib/host-service.js.backup",
		"/opt/jedv/lib/node --eval 'console.log(\"host-service.js\")'",
		"/usr/bin/node /tmp/jedv-host/server.js",
		"/usr/bin/node /tmp/server.js --name jedv-host",
		"/usr/bin/node /tmp/server.js /opt/jedv/lib/node /opt/jedv/lib/host-service.js",
		"/opt/jedv/bin/jedv-host-unrelated",
		"/opt/other/lib/node /opt/other/lib/host-service.js",
		"/usr/bin/node -e setInterval(()=>{},1000) /lib/node /usr/bin/node -e setInterval(()=>{},1000) /lib/host-service.js",
	])("rejects unrelated commands mentioning host names: %s", (command) => {
		expect(looksLikeHostProcess(command, "/opt/jedv/bin/jedv-host")).toBe(
			false,
		);
	});

	test("does not match an unrelated command", () => {
		expect(looksLikeHostProcess("/usr/sbin/some-other-daemon")).toBe(false);
	});
});
