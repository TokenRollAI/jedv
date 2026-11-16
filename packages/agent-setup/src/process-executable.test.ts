import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { realpath } from "node:fs/promises";
import {
	parseProcessExecutableOutput,
	readProcessExecutable,
} from "./process-executable";

const supported = process.platform === "darwin" || process.platform === "linux";

test.skipIf(!supported)(
	"reads the running executable from the kernel",
	async () => {
		const executable = await readProcessExecutable(process.pid);
		expect(executable).not.toBeNull();
		if (!executable) throw new Error("Missing executable identity");
		expect(await realpath(executable)).toBe(await realpath(process.execPath));
	},
);

test.skipIf(!supported)(
	"forged argv0 cannot become executable identity",
	async () => {
		const forged = "/tmp/jedv-owned-fake-native-executable";
		const child = spawn(
			process.execPath,
			["-e", 'process.stdout.write("ready\\n"); process.stdin.resume();'],
			{
				argv0: forged,
				env: { PATH: "/usr/bin:/bin" },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		const exited = once(child, "exit");
		try {
			await once(child.stdout, "data");
			if (!child.pid) throw new Error("Missing owned child PID");
			const executable = await readProcessExecutable(child.pid);
			expect(executable).not.toBeNull();
			expect(executable).not.toBe(forged);
			if (!executable) throw new Error("Missing executable identity");
			expect(await realpath(executable)).toBe(await realpath(process.execPath));
		} finally {
			child.stdin.end();
			await exited;
		}
	},
);

test.each([
	0,
	-1,
	1.5,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	2_147_483_648,
])("invalid PID %s has no executable identity", async (pid) =>
	expect(await readProcessExecutable(pid)).toBeNull());

test("an absent process has no executable identity", async () => {
	expect(await readProcessExecutable(2_147_483_647)).toBeNull();
});

test("JSON framing never turns a newline-bearing executable into a different path", () => {
	for (const path of [
		"/tmp/native\n",
		"/tmp/native\r",
		"/tmp/native\0",
		"/tmp/a\nb",
	])
		expect(
			parseProcessExecutableOutput(`${JSON.stringify(path)}\n`),
		).toBeNull();
	const path = "/tmp/native name";
	expect(parseProcessExecutableOutput(`${JSON.stringify(path)}\n`)).toBe(path);
	for (const output of ["/tmp/unframed\n", "null", "{}", '"relative"'])
		expect(parseProcessExecutableOutput(output)).toBeNull();
});
