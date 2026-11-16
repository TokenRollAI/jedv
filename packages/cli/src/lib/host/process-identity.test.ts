import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { verifyManifestOwner } from "./manifest-liveness";
import {
	inspectProcessCommand,
	inspectProcessExecutable,
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
	test.each([
		"/Applications/Jedv.app/Contents/MacOS/Jedv /Applications/Jedv.app/Contents/Resources/app.asar/dist/main/host-service.js",
		"/Applications/Jedv Dev.app/Contents/MacOS/Jedv /Applications/Jedv Dev.app/Contents/Resources/app.asar/dist/main/host-service.js",
		"/work/my repo/node_modules/.bun/electron@44.10.0/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /work/my repo/apps/desktop/dist/main/host-service.js",
		"/work/jedv/apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /work/jedv/apps/desktop/dist/main/host-service.js",
		"/work/jedv/node_modules/electron/dist/electron /work/jedv/apps/desktop/dist/main/host-service.js",
	])("matches a desktop executable and its own host entry: %s", (command) => {
		expect(
			looksLikeHostProcess(
				command,
				undefined,
				command.slice(0, command.lastIndexOf(" /")),
			),
		).toBe(true);
	});

	test.each([
		"/usr/bin/node /tmp/task/Contents/MacOS/Jedv /usr/bin/node /tmp/task/Contents/Resources/app.asar/dist/main/host-service.js",
		"/usr/bin/node /tmp/script.js /Applications/Jedv.app/Contents/MacOS/Jedv /Applications/Jedv.app/Contents/Resources/app.asar/dist/main/host-service.js",
		"/Applications/Jedv.app/Contents/MacOS/Jedv /tmp/host-service.js",
		"/Applications/Jedv.app/Contents/MacOS/Jedv /Applications/Other.app/Contents/Resources/app.asar/dist/main/host-service.js",
		"/work/one/node_modules/electron/dist/electron /work/two/apps/desktop/dist/main/host-service.js",
		"/work/one/node_modules/electron/dist/electron --eval /work/one/apps/desktop/dist/main/host-service.js",
		"/work/one/node_modules/electron/dist/electron /work/one/apps/desktop/dist/main/host-service.js.backup",
		"/work/one/node_modules/electron/dist/electron /work/one/apps/desktop/dist/main/host-service.js --unrelated",
	])("rejects desktop path mentions without the launch pair: %s", (command) => {
		expect(looksLikeHostProcess(command, undefined, "/usr/bin/node")).toBe(
			false,
		);
	});

	test("matches a command that runs the host binary", () => {
		expect(
			looksLikeHostProcess(
				"/opt/jedv/bin/jedv-host",
				undefined,
				"/opt/jedv/bin/jedv-host",
			),
		).toBe(true);
	});

	test.each([
		"/opt/jedv/lib/node /opt/jedv/lib/host-service.js",
		"/opt/jedv/bin/../lib/node /opt/jedv/bin/../lib/host-service.js",
	])("matches the standalone wrapper after exec: %s", (command) => {
		expect(
			looksLikeHostProcess(
				command,
				"/opt/jedv/bin/jedv-host",
				"/opt/jedv/lib/node",
			),
		).toBe(true);
	});

	test("matches a standalone installation path containing spaces", () => {
		expect(
			looksLikeHostProcess(
				"/opt/Jedv App/lib/node /opt/Jedv App/lib/host-service.js",
				"/opt/Jedv App/bin/jedv-host",
				"/opt/Jedv App/lib/node",
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
		expect(
			looksLikeHostProcess(
				command,
				"/opt/jedv/bin/jedv-host",
				"/opt/jedv/lib/node",
			),
		).toBe(false);
	});

	test("does not match an unrelated command", () => {
		expect(looksLikeHostProcess("/usr/sbin/some-other-daemon")).toBe(false);
	});
});

test("executable inspection returns a separate executable field", async () => {
	const executable = await inspectProcessExecutable(process.pid);
	expect(executable).not.toBeNull();
	expect(executable).not.toContain("process-identity.test.ts");
});

test("command text alone never proves ownership", () => {
	for (const executable of [null, undefined]) {
		expect(
			looksLikeHostProcess("/opt/jedv/bin/jedv-host", undefined, executable),
		).toBe(false);
		expect(
			looksLikeHostProcess(
				"/opt/jedv/lib/node /opt/jedv/lib/host-service.js",
				"/opt/jedv/bin/jedv-host",
				executable,
			),
		).toBe(false);
	}
});

test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
	"a real process with a forged host argv0 never owns a host manifest",
	async () => {
		const child = spawn(
			process.execPath,
			["-e", 'process.stdout.write("ready\\n"); process.stdin.resume();'],
			{
				argv0: "/opt/jedv/bin/jedv-host",
				env: { PATH: "/usr/bin:/bin" },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		const exited = once(child, "exit");
		try {
			await once(child.stdout, "data");
			if (!child.pid) throw new Error("Missing owned child PID");
			expect(
				await verifyManifestOwner(
					{
						pid: child.pid,
						endpoint: "http://127.0.0.1:1",
						authToken: "fixture",
						organizationId: "fixture",
						startedAt: 0,
					},
					{
						probeHealthy: async () => {
							throw new Error("A forged process must not fall back to HTTP");
						},
					},
				),
			).toBe(false);
		} finally {
			child.stdin.end();
			await exited;
		}
	},
);
