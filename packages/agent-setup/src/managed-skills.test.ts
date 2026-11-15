import { afterEach, beforeEach, expect, test } from "bun:test";
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
import {
	createManagedSkills,
	MANAGED_SENTINEL_NAME,
	MANAGED_SKILL_MARKER,
	provisionManagedClaudePluginAt,
	setFrontmatterName,
	withManagedMarker,
} from "./managed-skills";

let root: string;
let home: string;
let templates: string;
let installed: string;
beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "jedv-empty-skills-"));
	home = path.join(root, "home");
	templates = path.join(root, "templates");
	installed = path.join(root, "installed_plugins.json");
	mkdirSync(home);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(file: string, contents: string) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, contents);
}
function options() {
	return {
		homeDir: home,
		templatesDir: templates,
		installedPluginsFile: installed,
	};
}
function existingFiles() {
	const files = [
		path.join(home, ".agents/skills/owned-workflow/SKILL.md"),
		path.join(home, ".agents/commands/jedv/feedback.md"),
		path.join(home, ".claude/skills/jedv", MANAGED_SENTINEL_NAME),
		path.join(home, ".claude/skills/jedv/skills/owned-workflow/SKILL.md"),
	];
	for (const file of files)
		write(file, `${MANAGED_SKILL_MARKER}\nkeep ${file}`);
	return files.map((file) => [file, readFileSync(file, "utf8")] as const);
}

test("missing installation state and no bundle create no plugin surfaces", async () => {
	await createManagedSkills(options());
	expect(existsSync(path.join(home, ".agents"))).toBe(false);
	expect(existsSync(path.join(home, ".claude"))).toBe(false);
	expect(existsSync(installed)).toBe(false);
});

test("an empty install list cannot reap existing plugin skills or commands even with an old bundle", async () => {
	write(
		path.join(templates, "plugin/skills/feedback/SKILL.md"),
		"---\nname: feedback\n---\nlegacy",
	);
	write(installed, JSON.stringify({ version: 1, plugins: [] }));
	const before = existingFiles();
	await createManagedSkills(options());
	await provisionManagedClaudePluginAt(path.join(home, ".claude"), options());
	for (const [file, contents] of before)
		expect(readFileSync(file, "utf8")).toBe(contents);
	expect(existsSync(path.join(home, ".agents/skills/jedv-feedback"))).toBe(
		false,
	);
});

test("retiring the bundle preserves installed trees and the registry byte for byte", async () => {
	const source = path.join(root, "user-plugin");
	write(path.join(source, "skills/workflow/SKILL.md"), "user plugin");
	const registry = JSON.stringify({
		version: 1,
		plugins: [{ name: "owned", enabled: true, installPath: source }],
	});
	write(installed, registry);
	const before = existingFiles();
	await createManagedSkills(options());
	expect(readFileSync(installed, "utf8")).toBe(registry);
	expect(
		readFileSync(path.join(source, "skills/workflow/SKILL.md"), "utf8"),
	).toBe("user plugin");
	for (const [file, contents] of before)
		expect(readFileSync(file, "utf8")).toBe(contents);
});

test("an unreadable registry does not authorize reaping", async () => {
	write(path.join(templates, "plugin/skills/feedback/SKILL.md"), "legacy");
	write(installed, "{");
	const before = existingFiles();
	await createManagedSkills(options());
	for (const [file, contents] of before)
		expect(readFileSync(file, "utf8")).toBe(contents);
	expect(readFileSync(installed, "utf8")).toBe("{");
});

test("authoring helpers preserve frontmatter and add only one managed marker", () => {
	const source = "---\nname: workflow\n---\n# Body\n";
	const renamed = setFrontmatterName(source, "owned-workflow");
	expect(renamed).toContain("name: owned-workflow");
	expect(renamed).toContain("# Body");
	expect(withManagedMarker(withManagedMarker(renamed))).toBe(
		withManagedMarker(renamed),
	);
});
