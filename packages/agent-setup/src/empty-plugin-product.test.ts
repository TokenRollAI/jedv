import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("agent bootstrap does not install a plugin or a default marketplace", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "jedv-empty-bootstrap-"));
	directories.push(root);
	const home = path.join(root, "home");
	const appHome = path.join(root, "app");
	const templates = path.join(root, "templates");
	const skill = path.join(templates, "plugin/skills/legacy/SKILL.md");
	mkdirSync(path.dirname(skill), { recursive: true });
	writeFileSync(skill, "---\nname: legacy\n---\nlegacy bundled skill");
	const existing = path.join(home, ".agents/skills/user-skill/SKILL.md");
	mkdirSync(path.dirname(existing), { recursive: true });
	writeFileSync(existing, "keep my skill");
	const configUrl = pathToFileURL(path.join(import.meta.dir, "config.ts")).href;
	const setupUrl = pathToFileURL(
		path.join(import.meta.dir, "agent-setup.ts"),
	).href;
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`import {setAgentSetupTemplatesDir} from ${JSON.stringify(configUrl)};
import {setupAgentCapabilities} from ${JSON.stringify(setupUrl)};
setAgentSetupTemplatesDir(${JSON.stringify(templates)});
setupAgentCapabilities();`,
		],
		{
			env: { ...process.env, HOME: home, JEDV_HOME_DIR: appHome },
			stdout: "ignore",
			stderr: "pipe",
		},
	);
	const [code, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	expect(code, stderr).toBe(0);
	expect(existsSync(path.join(home, ".agents/skills/jedv-legacy"))).toBe(false);
	expect(existsSync(path.join(home, ".claude/skills/jedv"))).toBe(false);
	expect(existsSync(path.join(appHome, "plugins/installed_plugins.json"))).toBe(
		false,
	);
	expect(
		existsSync(path.join(appHome, "plugins/known_marketplaces.json")),
	).toBe(false);
	expect(readFileSync(existing, "utf8")).toBe("keep my skill");
});
