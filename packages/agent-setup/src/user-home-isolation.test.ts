import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("JEDV_USER_HOME_DIR redirects native Agent configs without changing HOME", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "jedv-user-home-"));
	const userHome = path.join(root, "user"),
		appHome = path.join(root, "app");
	const paths = pathToFileURL(path.join(import.meta.dir, "paths.ts")).href;
	const setup = pathToFileURL(
		path.join(import.meta.dir, "agent-setup.ts"),
	).href;
	try {
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				`
import {resolveUserHomeDir,resolveAppHomeDir} from ${JSON.stringify(paths)};
import {setupAgentCapabilities} from ${JSON.stringify(setup)};
const originalHome=process.env.HOME;
const effective=resolveUserHomeDir();
setupAgentCapabilities();
if(process.env.HOME!==originalHome) throw new Error('HOME changed');
console.log(JSON.stringify({effective,appHome:resolveAppHomeDir()}));
`,
			],
			{
				env: {
					...process.env,
					JEDV_USER_HOME_DIR: userHome,
					JEDV_HOME_DIR: appHome,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, out, err] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(code, err).toBe(0);
		expect(JSON.parse(out.trim().split("\n").at(-1) ?? "{}")).toEqual({
			effective: userHome,
			appHome,
		});
		for (const relative of [".claude/settings.json", ".codex/hooks.json"]) {
			const file = path.join(userHome, relative);
			expect(existsSync(file)).toBe(true);
			expect(readFileSync(file, "utf8")).toContain("JEDV_HOME_DIR");
		}
		expect(
			existsSync(path.join(userHome, ".agents/skills/jedv-team/SKILL.md")),
		).toBe(true);
		const fallbackEnv = { ...process.env };
		delete fallbackEnv.JEDV_USER_HOME_DIR;
		const fallback = Bun.spawn(
			[
				process.execPath,
				"-e",
				`import {resolveUserHomeDir} from ${JSON.stringify(paths)}; import os from 'node:os'; console.log(JSON.stringify({actual:resolveUserHomeDir(),expected:process.platform==='win32'?os.homedir():(process.env.HOME||os.homedir())}));`,
			],
			{ env: fallbackEnv, stdout: "pipe", stderr: "pipe" },
		);
		const data = JSON.parse(await new Response(fallback.stdout).text());
		expect(await fallback.exited).toBe(0);
		expect(data.actual).toBe(data.expected);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
