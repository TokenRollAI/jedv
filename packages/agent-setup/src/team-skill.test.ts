import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { provisionBuiltinTeamSkill } from "./managed-skills";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
test("the Team skill is installed idempotently without a marketplace and preserves user-owned skills", () => {
	const homeDir = mkdtempSync(path.join(tmpdir(), "jedv-team-skill-"));
	roots.push(homeDir);
	const owned = path.join(homeDir, ".claude/skills/jedv-team/SKILL.md");
	mkdirSync(path.dirname(owned), { recursive: true });
	writeFileSync(owned, "My own skill");
	provisionBuiltinTeamSkill({ homeDir });
	const target = path.join(homeDir, ".agents/skills/jedv-team/SKILL.md");
	expect(readFileSync(target, "utf8")).toContain("jedv mail ack");
	const time = statSync(target).mtimeMs;
	provisionBuiltinTeamSkill({ homeDir });
	expect(statSync(target).mtimeMs).toBe(time);
	expect(readFileSync(owned, "utf8")).toBe("My own skill");
	expect(
		existsSync(path.join(homeDir, ".jedv/plugins/installed_plugins.json")),
	).toBe(false);
	provisionBuiltinTeamSkill({ homeDir, disabled: true });
	expect(existsSync(target)).toBe(false);
	expect(readFileSync(owned, "utf8")).toBe("My own skill");
});
