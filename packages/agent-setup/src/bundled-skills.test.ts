import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
	JEDV_HOSTED_PLUGINS,
	JEDV_MANAGED_SKILLS,
	PLUGIN_CATALOG,
} from "@jedv/shared/plugins";

test("repository packaging inputs contain no preinstalled plugin", () => {
	const root = path.resolve(import.meta.dir, "../../../plugins");
	for (const entry of existsSync(root)
		? readdirSync(root, { withFileTypes: true })
		: []) {
		if (!entry.isDirectory()) continue;
		const directory = path.join(root, entry.name);
		expect(existsSync(path.join(directory, "plugin.json"))).toBe(false);
		expect(
			existsSync(path.join(directory, ".claude-plugin", "plugin.json")),
		).toBe(false);
		expect(existsSync(path.join(directory, "skills"))).toBe(false);
	}
	expect(PLUGIN_CATALOG).toEqual([]);
	expect(JEDV_HOSTED_PLUGINS).toEqual([]);
	expect(JEDV_MANAGED_SKILLS).toEqual([]);
});
