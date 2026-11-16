import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readAgentLaunchEvidence,
	removeAgentLaunchEvidence,
} from "./agent-launch-status";
import { getKimiWrapperScript } from "./agent-wrappers-kimi";

let root: string;
let saved: string | undefined;
beforeEach(() => {
	saved = process.env.JEDV_HOME_DIR;
	root = mkdtempSync(join(tmpdir(), "jedv-launch-evidence-"));
	process.env.JEDV_HOME_DIR = root;
});
afterEach(() => {
	if (saved === undefined) delete process.env.JEDV_HOME_DIR;
	else process.env.JEDV_HOME_DIR = saved;
	rmSync(root, { recursive: true, force: true });
});

test.each([
	0, 2, 127,
])("actual Kimi wrapper records immediate exit %s without losing argv", (code) => {
	const bin = join(root, "real");
	const wrappers = join(root, "bin");
	mkdirSync(bin);
	mkdirSync(wrappers);
	writeFileSync(
		join(bin, "kimi"),
		`#!/bin/bash\nprintf '%s\\n' "$@"\nexit ${code}\n`,
		{ mode: 0o755 },
	);
	const wrapper = join(wrappers, "kimi");
	writeFileSync(wrapper, getKimiWrapperScript(), { mode: 0o755 });
	const env = {
		...process.env,
		PATH: `${wrappers}:${bin}:/usr/bin:/bin`,
		JEDV_HOME_DIR: root,
		JEDV_USER_HOME_DIR: join(root, "user"),
		JEDV_TERMINAL_ID: "terminal",
		JEDV_AGENT_RUN_ID: "run",
		JEDV_AGENT_ID: "",
		JEDV_AGENT_LAUNCH_ID: "",
	};
	const result = spawnSync(wrapper, ["-p", "literal ; $(unchanged)"], {
		env,
		encoding: "utf8",
	});
	expect(result.status).toBe(code);
	expect(result.stdout).toBe("-p\nliteral ; $(unchanged)\n");
	expect(readAgentLaunchEvidence("terminal", "run")).toMatchObject({
		runId: "run",
		exitCode: code,
	});
	expect(readAgentLaunchEvidence("terminal", "old-run")).toBeNull();
	removeAgentLaunchEvidence("terminal");
	expect(readAgentLaunchEvidence("terminal", "run")).toBeNull();
});

test("malformed, oversized, symlink and traversal evidence is never accepted", () => {
	const dir = join(root, "state/agent-launches");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "terminal.json");
	for (const content of [
		"null",
		"{",
		JSON.stringify({ runId: "run", launchId: "launch", exitCode: -1 }),
		" ".repeat(2048),
	]) {
		writeFileSync(file, content);
		expect(readAgentLaunchEvidence("terminal", "run")).toBeNull();
	}
	rmSync(file);
	const outside = join(root, "outside.json");
	writeFileSync(outside, JSON.stringify({ runId: "run", launchId: "launch" }));
	symlinkSync(outside, file);
	expect(readAgentLaunchEvidence("terminal", "run")).toBeNull();
	expect(readAgentLaunchEvidence("../../outside", "run")).toBeNull();
	removeAgentLaunchEvidence("../../outside");
	expect(existsSync(outside)).toBe(true);
});

test("missing Kimi binary records exit 127 instead of leaving readiness ambiguous", () => {
	const wrappers = join(root, "bin");
	mkdirSync(wrappers);
	const wrapper = join(wrappers, "kimi");
	writeFileSync(wrapper, getKimiWrapperScript(), { mode: 0o755 });
	const result = spawnSync(wrapper, ["-p", "go"], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${wrappers}:/usr/bin:/bin`,
			JEDV_HOME_DIR: root,
			JEDV_USER_HOME_DIR: join(root, "user"),
			JEDV_TERMINAL_ID: "terminal",
			JEDV_AGENT_RUN_ID: "run",
			JEDV_AGENT_ID: "",
			JEDV_AGENT_LAUNCH_ID: "",
		},
	});
	expect(result.status).toBe(127);
	expect(readAgentLaunchEvidence("terminal", "run")).toMatchObject({
		exitCode: 127,
	});
});
