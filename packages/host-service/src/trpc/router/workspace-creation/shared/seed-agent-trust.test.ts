import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	encodeKimiWorkDirKey,
	resolveTrustFamily,
	seedAgentFolderTrust,
	seedAgyFolderTrust,
	seedClaudeFolderTrust,
	seedCodexFolderTrust,
	seedKimiFolderTrust,
} from "./seed-agent-trust";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "seed-agent-trust-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("resolveTrustFamily", () => {
	test("matches by preset id", () => {
		expect(resolveTrustFamily({ presetId: "claude", command: "claude" })).toBe(
			"claude",
		);
		expect(resolveTrustFamily({ presetId: "codex", command: "codex" })).toBe(
			"codex",
		);
		expect(
			resolveTrustFamily({
				presetId: "agy",
				command: "agy --dangerously-skip-permissions",
			}),
		).toBe("agy");
		expect(
			resolveTrustFamily({
				presetId: "kimi",
				command: "kimi --yolo",
			}),
		).toBe("kimi");
	});

	test("matches custom presets by launch executable", () => {
		expect(
			resolveTrustFamily({
				presetId: "custom-abc",
				command: "/usr/local/bin/claude --verbose",
			}),
		).toBe("claude");
		expect(
			resolveTrustFamily({
				presetId: "custom-def",
				command: "C:\\tools\\codex.exe",
			}),
		).toBe("codex");
		expect(
			resolveTrustFamily({
				presetId: "custom-kimi",
				command: "/opt/bin/kimi --yolo",
			}),
		).toBe("kimi");
	});

	test("returns null for providers without a known trust store", () => {
		expect(resolveTrustFamily({ presetId: "gemini", command: "gemini" })).toBe(
			null,
		);
		expect(
			resolveTrustFamily({ presetId: "custom-xyz", command: "my-agent" }),
		).toBe(null);
	});
});

describe("seedClaudeFolderTrust", () => {
	test("creates the state file with the trusted entry", async () => {
		const file = join(dir, ".claude.json");
		await seedClaudeFolderTrust(file, "/tmp/session-a");
		const state = JSON.parse(readFileSync(file, "utf-8"));
		expect(state.projects["/tmp/session-a"].hasTrustDialogAccepted).toBe(true);
	});

	test("merges into existing state, preserving other keys", async () => {
		const file = join(dir, ".claude.json");
		writeFileSync(
			file,
			JSON.stringify({
				oauthAccount: { emailAddress: "x@y.z" },
				projects: {
					"/existing": { hasTrustDialogAccepted: true, allowedTools: ["Bash"] },
					"/tmp/session-b": { allowedTools: ["Edit"] },
				},
			}),
		);
		await seedClaudeFolderTrust(file, "/tmp/session-b");
		const state = JSON.parse(readFileSync(file, "utf-8"));
		expect(state.oauthAccount.emailAddress).toBe("x@y.z");
		expect(state.projects["/existing"].allowedTools).toEqual(["Bash"]);
		expect(state.projects["/tmp/session-b"]).toEqual({
			allowedTools: ["Edit"],
			hasTrustDialogAccepted: true,
		});
	});

	test("no-ops when the entry is already trusted", async () => {
		const file = join(dir, ".claude.json");
		const content = JSON.stringify({
			projects: { "/tmp/session-c": { hasTrustDialogAccepted: true } },
		});
		writeFileSync(file, content);
		await seedClaudeFolderTrust(file, "/tmp/session-c");
		expect(readFileSync(file, "utf-8")).toBe(content);
	});

	test("throws on a corrupt state file without clobbering it", async () => {
		const file = join(dir, ".claude.json");
		writeFileSync(file, "{not json");
		await expect(
			seedClaudeFolderTrust(file, "/tmp/session-d"),
		).rejects.toThrow();
		expect(readFileSync(file, "utf-8")).toBe("{not json");
	});

	test("skips when the config dir itself does not exist", async () => {
		const file = join(dir, "missing-profile", ".claude.json");
		await seedClaudeFolderTrust(file, "/tmp/session-e");
		expect(() => readFileSync(file, "utf-8")).toThrow();
	});

	test("preserves a tightened file mode across the rewrite", async () => {
		const file = join(dir, ".claude.json");
		writeFileSync(file, "{}");
		chmodSync(file, 0o600);
		await seedClaudeFolderTrust(file, "/tmp/session-f");
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test("creates a brand-new store owner-only", async () => {
		const file = join(dir, ".claude.json");
		await seedClaudeFolderTrust(file, "/tmp/session-g");
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test("writes through a symlinked state file instead of replacing it", async () => {
		const dotfiles = join(dir, "dotfiles-claude");
		const home = join(dir, "home");
		mkdirSync(dotfiles);
		mkdirSync(home);
		const real = join(dotfiles, ".claude.json");
		writeFileSync(real, JSON.stringify({ oauthAccount: { id: "a" } }));
		const file = join(home, ".claude.json");
		symlinkSync(real, file);

		await seedClaudeFolderTrust(file, "/tmp/session-link");

		expect(lstatSync(file).isSymbolicLink()).toBe(true);
		const state = JSON.parse(readFileSync(real, "utf-8"));
		expect(state.oauthAccount.id).toBe("a");
		expect(state.projects["/tmp/session-link"].hasTrustDialogAccepted).toBe(
			true,
		);
		expect(readdirSync(home)).toEqual([".claude.json"]);
	});
});

describe("seedAgyFolderTrust", () => {
	test("appends to trustedWorkspaces, preserving other keys", async () => {
		const file = join(dir, "settings.json");
		writeFileSync(
			file,
			JSON.stringify({ trustedWorkspaces: ["/other"], theme: "dark" }),
		);
		await seedAgyFolderTrust(file, "/tmp/session-a");
		await seedAgyFolderTrust(file, "/tmp/session-a");
		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({
			trustedWorkspaces: ["/other", "/tmp/session-a"],
			theme: "dark",
		});
	});

	test("leaves a never-set-up agy alone", async () => {
		await seedAgyFolderTrust(
			join(dir, "missing", "settings.json"),
			"/tmp/session-b",
		);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("adds both raw and realpathSync paths for symlinked worktrees", async () => {
		const target = join(dir, "real-worktree");
		const link = join(dir, "symlink-worktree");
		mkdirSync(target);
		symlinkSync(target, link);
		const file = join(dir, "settings.json");
		writeFileSync(file, "{}");

		await seedAgyFolderTrust(file, link);
		await seedAgyFolderTrust(file, link);

		const saved = JSON.parse(readFileSync(file, "utf-8")) as {
			trustedWorkspaces: string[];
		};
		expect(saved.trustedWorkspaces).toEqual([link, realpathSync(target)]);
	});

	test("seeds kimi workspace-trust records and agy trustedWorkspaces through seedAgentFolderTrust", async () => {
		const prevUserHome = process.env.JEDV_USER_HOME_DIR;
		process.env.JEDV_USER_HOME_DIR = dir;
		try {
			const agyDir = join(dir, ".gemini", "antigravity-cli");
			const kimiDir = join(dir, ".kimi-code");
			mkdirSync(agyDir, { recursive: true });
			mkdirSync(kimiDir, { recursive: true });
			const settingsFile = join(agyDir, "settings.json");
			writeFileSync(settingsFile, "{}");

			const realDir = join(dir, "real-wt");
			const linkDir = join(dir, "link-wt");
			mkdirSync(realDir);
			symlinkSync(realDir, linkDir);

			await seedAgentFolderTrust({} as never, linkDir, {
				presetId: "agy",
				command: "agy",
				env: {},
			});
			expect(
				JSON.parse(readFileSync(settingsFile, "utf-8")).trustedWorkspaces,
			).toEqual([linkDir, realpathSync(realDir)]);

			await seedAgentFolderTrust({} as never, linkDir, {
				presetId: "kimi",
				command: "kimi",
				env: {},
			});
			const linkKey = encodeKimiWorkDirKey(linkDir);
			const realKey = encodeKimiWorkDirKey(realpathSync(realDir));
			expect(
				JSON.parse(
					readFileSync(join(kimiDir, "workspace-trust", linkKey), "utf-8"),
				).root,
			).toBe(linkDir);
			expect(
				JSON.parse(
					readFileSync(join(kimiDir, "workspace-trust", realKey), "utf-8"),
				).root,
			).toBe(realpathSync(realDir));
		} finally {
			if (prevUserHome === undefined) delete process.env.JEDV_USER_HOME_DIR;
			else process.env.JEDV_USER_HOME_DIR = prevUserHome;
		}
	});
});

describe("seedKimiFolderTrust", () => {
	test("matches Kimi Code's wd_<slug>_<sha256-12> key format", () => {
		expect(encodeKimiWorkDirKey("/private/tmp/jedv-parity-ui-project")).toBe(
			"wd_jedv-parity-ui-project_6a88416411b6",
		);
	});

	test("leaves a never-set-up kimi home alone", async () => {
		await seedKimiFolderTrust(
			join(dir, "missing", "workspace-trust"),
			"/tmp/session-kimi",
		);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("preserves existing trust records without overwriting trustedAt", async () => {
		const trustDir = join(dir, ".kimi-code", "workspace-trust");
		mkdirSync(trustDir, { recursive: true });
		const target = join(dir, "project-a");
		mkdirSync(target);
		const key = encodeKimiWorkDirKey(target);
		const recordFile = join(trustDir, key);
		const existing = JSON.stringify({ root: target, trustedAt: 12345 });
		writeFileSync(recordFile, existing);

		await seedKimiFolderTrust(trustDir, target);
		expect(readFileSync(recordFile, "utf-8")).toBe(existing);
	});
});

describe("seedCodexFolderTrust", () => {
	test("creates config.toml with the trusted table", async () => {
		const file = join(dir, "config.toml");
		await seedCodexFolderTrust(file, "/tmp/session-a");
		expect(readFileSync(file, "utf-8")).toBe(
			'[projects."/tmp/session-a"]\ntrust_level = "trusted"\n',
		);
	});

	test("appends after existing content, preserving it", async () => {
		const file = join(dir, "config.toml");
		writeFileSync(
			file,
			'model = "gpt-5"\n\n[projects."/other"]\ntrust_level = "trusted"\n',
		);
		await seedCodexFolderTrust(file, "/tmp/session-b");
		expect(readFileSync(file, "utf-8")).toBe(
			'model = "gpt-5"\n\n[projects."/other"]\ntrust_level = "trusted"\n\n[projects."/tmp/session-b"]\ntrust_level = "trusted"\n',
		);
	});

	test("leaves an existing table for the path untouched", async () => {
		const file = join(dir, "config.toml");
		const content = '[projects."/tmp/session-c"]\ntrust_level = "untrusted"\n';
		writeFileSync(file, content);
		await seedCodexFolderTrust(file, "/tmp/session-c");
		expect(readFileSync(file, "utf-8")).toBe(content);
	});

	test("escapes quotes and backslashes in the path key", async () => {
		const file = join(dir, "config.toml");
		await seedCodexFolderTrust(file, '/tmp/we"ird\\path');
		expect(readFileSync(file, "utf-8")).toBe(
			'[projects."/tmp/we\\"ird\\\\path"]\ntrust_level = "trusted"\n',
		);
	});

	test("skips when the codex home does not exist", async () => {
		const file = join(dir, "missing-home", "config.toml");
		await seedCodexFolderTrust(file, "/tmp/session-d");
		expect(() => readFileSync(file, "utf-8")).toThrow();
	});

	test("detects an equivalent header with different spacing", async () => {
		const file = join(dir, "config.toml");
		const content =
			'[ projects . "/tmp/session-e" ]\ntrust_level = "untrusted"\n';
		writeFileSync(file, content);
		await seedCodexFolderTrust(file, "/tmp/session-e");
		expect(readFileSync(file, "utf-8")).toBe(content);
	});

	test("detects a literal-string header", async () => {
		const file = join(dir, "config.toml");
		const content =
			"[projects.'/tmp/session-f']\ntrust_level = \"untrusted\"\n";
		writeFileSync(file, content);
		await seedCodexFolderTrust(file, "/tmp/session-f");
		expect(readFileSync(file, "utf-8")).toBe(content);
	});

	test("detects a top-level dotted key", async () => {
		const file = join(dir, "config.toml");
		const content = 'projects."/tmp/session-g".trust_level = "untrusted"\n';
		writeFileSync(file, content);
		await seedCodexFolderTrust(file, "/tmp/session-g");
		expect(readFileSync(file, "utf-8")).toBe(content);
	});

	test("matches an escaped header against the raw path", async () => {
		const file = join(dir, "config.toml");
		const content =
			'[projects."/tmp/we\\"ird\\\\path"]\ntrust_level = "untrusted"\n';
		writeFileSync(file, content);
		await seedCodexFolderTrust(file, '/tmp/we"ird\\path');
		expect(readFileSync(file, "utf-8")).toBe(content);
	});

	test("still appends when only a different path is defined", async () => {
		const file = join(dir, "config.toml");
		writeFileSync(file, '[ projects . "/other" ]\ntrust_level = "trusted"\n');
		await seedCodexFolderTrust(file, "/tmp/session-h");
		expect(readFileSync(file, "utf-8")).toContain(
			'[projects."/tmp/session-h"]\ntrust_level = "trusted"\n',
		);
	});

	test("writes through a symlinked config.toml instead of replacing it", async () => {
		const dotfiles = join(dir, "dotfiles");
		const codexHome = join(dir, ".codex");
		mkdirSync(dotfiles);
		mkdirSync(codexHome);
		const real = join(dotfiles, "config.toml");
		writeFileSync(real, 'model = "gpt-5"\n');
		const file = join(codexHome, "config.toml");
		symlinkSync(real, file);

		await seedCodexFolderTrust(file, "/tmp/session-link");

		expect(lstatSync(file).isSymbolicLink()).toBe(true);
		expect(readFileSync(real, "utf-8")).toBe(
			'model = "gpt-5"\n\n[projects."/tmp/session-link"]\ntrust_level = "trusted"\n',
		);
		expect(readdirSync(codexHome)).toEqual(["config.toml"]);
	});
});
