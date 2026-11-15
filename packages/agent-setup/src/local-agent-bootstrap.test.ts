import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("local bootstrap installs four agents without changing unrelated configuration", async () => {
	const directory = mkdtempSync(join(tmpdir(), "jedv-agent-bootstrap-"));
	try {
		const userHome = join(directory, "user");
		const appHome = join(directory, "jedv");
		const untouched = join(userHome, ".config/opencode/plugin/jedv-notify.js");
		mkdirSync(join(userHome, ".config/opencode/plugin"), { recursive: true });
		writeFileSync(
			untouched,
			"// Jedv opencode plugin v11\nkeep this existing file",
		);
		const ledger = join(appHome, "plugins/installed_plugins.json");
		mkdirSync(join(appHome, "plugins"), { recursive: true });
		writeFileSync(ledger, '{"userPlugin":"keep"}');
		const source = pathToFileURL(join(import.meta.dir, "index.ts")).href;
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				`import {setupAgentIntegrations} from ${JSON.stringify(source)}; setupAgentIntegrations();`,
			],
			{
				env: {
					PATH: process.env.PATH,
					HOME: userHome,
					JEDV_HOME_DIR: appHome,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(code, `${stdout}\n${stderr}`).toBe(0);
		for (const agent of ["claude", "codex", "agy", "kimi"]) {
			expect(existsSync(join(appHome, "bin", agent)), agent).toBe(true);
		}
		expect(existsSync(join(appHome, "hooks/notify.sh"))).toBe(true);
		expect(existsSync(join(appHome, "bin/amp"))).toBe(false);
		expect(readFileSync(untouched, "utf8")).toBe(
			"// Jedv opencode plugin v11\nkeep this existing file",
		);
		expect(readFileSync(ledger, "utf8")).toBe('{"userPlugin":"keep"}');
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
