import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncManagedMcpServers } from "./managed-mcp-servers";
import { syncPluginMcpServers } from "./plugin-mcp-servers";

let root: string;
let home: string;
let jedvHome: string;
beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "jedv-empty-mcp-"));
	home = path.join(root, "home");
	jedvHome = path.join(root, "app");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("an empty product catalog does not create agent configs or install state", () => {
	expect(
		syncPluginMcpServers({ homeDir: home, jedvHomeDir: jedvHome }),
	).toEqual({ servers: 0, error: null });
	expect(readdirSync(root)).toEqual([]);
});

test("retiring the catalog preserves existing MCP entries and ledgers byte for byte", () => {
	syncManagedMcpServers(
		{ owned: { command: "user-mcp" } },
		{ homeDir: home, jedvHomeDir: jedvHome },
	);
	const installed = path.join(jedvHome, "plugins/installed_plugins.json");
	mkdirSync(path.dirname(installed), { recursive: true });
	writeFileSync(
		installed,
		JSON.stringify({
			version: 1,
			plugins: [{ name: "linear", enabled: true }],
		}),
	);
	const files = [
		installed,
		path.join(jedvHome, "plugins/mcp-ledger.json"),
		path.join(home, ".claude.json"),
		path.join(home, ".codex/config.toml"),
		path.join(home, ".jedv/agent/mcp.json"),
	];
	const before = files.map(
		(file) => [file, readFileSync(file, "utf8")] as const,
	);
	syncPluginMcpServers({ homeDir: home, jedvHomeDir: jedvHome });
	for (const [file, contents] of before)
		expect(readFileSync(file, "utf8")).toBe(contents);
	expect(existsSync(installed)).toBe(true);
});
