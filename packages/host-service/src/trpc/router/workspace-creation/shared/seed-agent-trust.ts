/**
 * Pre-trusts a host-created folder in the launching agent CLIs' trust
 * stores, so their first interactive launch skips the "do you trust this
 * folder?" dialog. Session folders need this because they are standalone
 * repos: agent CLIs treat a git repo root as its own trust domain (worktrees
 * inherit from the main checkout, plain dirs from trusted ancestors, but a
 * fresh standalone repo inherits nothing), so every new session would
 * otherwise prompt. Auto-trusting is sound only because the host itself just
 * created the folder as an empty scaffold — never seed a folder with
 * pre-existing user content.
 *
 * Each store is the CLI's own sanctioned escape hatch: Claude's untrusted-
 * folder error says to set `projects[<path>].hasTrustDialogAccepted: true`
 * in its state file, Codex persists `trust_level = "trusted"` in
 * config.toml the same way, and Antigravity lists trusted folders under
 * `trustedWorkspaces` in its settings.json. Everything here is best-effort — a failed seed
 * just means the dialog shows once.
 */

import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveUserHomeDir, resolveWriteTarget } from "@jedv/agent-setup";
import type { HostDb } from "../../../../db";
import { resolveDefaultAccountEnv } from "../../usage/default-account";

type TrustFamily = "claude" | "codex" | "agy" | "kimi";

interface TrustTarget {
	family: TrustFamily;
	file: string;
}

/**
 * Provider family of an agent config, from its preset id or launch
 * executable. The executable check covers custom presets that still run the
 * stock `claude`/`codex` binaries (possibly via absolute paths or wrappers
 * named after them).
 */
export function resolveTrustFamily(config: {
	presetId: string;
	command: string;
}): TrustFamily | null {
	const [token = ""] = config.command.trim().split(/\s+/);
	const executable = (token.split(/[\\/]/).pop() ?? "")
		.toLowerCase()
		.replace(/\.exe$/, "");
	for (const family of ["claude", "codex", "agy", "kimi"] as const) {
		if (config.presetId === family || executable === family) return family;
	}
	return null;
}

/**
 * Trust-store file for one agent config, mirroring launch-time resolution:
 * per-agent env wins over the host-default account selection
 * (`{...accountEnv, ...config.env}` in buildTerminalAgentLaunch, and the
 * agent wrapper's pointer-file fallback reads the same DB-backed selection).
 * Claude keeps state inside a custom CLAUDE_CONFIG_DIR but next door at
 * `~/.claude.json` for the default home; Codex always uses
 * `$CODEX_HOME/config.toml`.
 */
function resolveTrustTarget(
	db: HostDb,
	config: { presetId: string; command: string; env: Record<string, string> },
): TrustTarget | null {
	const family = resolveTrustFamily(config);
	if (family === null) return null;
	if (family === "agy") {
		return {
			family,
			file: join(
				resolveUserHomeDir(),
				".gemini",
				"antigravity-cli",
				"settings.json",
			),
		};
	}
	if (family === "kimi") {
		const kimiHome =
			config.env.KIMI_CODE_HOME?.trim() ||
			process.env.KIMI_CODE_HOME?.trim() ||
			join(resolveUserHomeDir(), ".kimi-code");
		return { family, file: join(kimiHome, "workspace-trust") };
	}
	const env = { ...resolveDefaultAccountEnv(db, family), ...config.env };
	if (family === "claude") {
		const configDir = env.CLAUDE_CONFIG_DIR;
		return {
			family,
			file: configDir
				? join(configDir, ".claude.json")
				: join(resolveUserHomeDir(), ".claude.json"),
		};
	}
	const codexHome = env.CODEX_HOME || join(resolveUserHomeDir(), ".codex");
	return { family, file: join(codexHome, "config.toml") };
}

/**
 * Same-directory tmp write + rename, so a crash never truncates the store.
 * The replacement keeps the store's existing mode — these files can sit next
 * to credentials, so a user-tightened mode must survive the rewrite — and a
 * brand-new store starts owner-only. `~/.codex/config.toml` is one of the
 * files people most often symlink into a dotfiles repo, and rename would
 * replace the link, so the write follows it to the same target agent-setup's
 * writeFileIfChanged resolves.
 */
async function atomicWrite(file: string, content: string): Promise<void> {
	const target = resolveWriteTarget(file);
	const mode = await stat(target).then(
		(info) => info.mode & 0o777,
		() => 0o600,
	);
	const tmpDir = await mkdtemp(join(dirname(target), ".jedv-trust-"));
	const tmpFile = join(tmpDir, "next");
	try {
		await writeFile(tmpFile, content);
		await chmod(tmpFile, mode);
		await rename(tmpFile, target);
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}

/**
 * Merge `projects[<path>].hasTrustDialogAccepted: true` into a Claude state
 * file, preserving every other key. A corrupt file throws instead of being
 * clobbered. No-op when the entry is already trusted.
 */
export async function seedClaudeFolderTrust(
	stateFile: string,
	folderPath: string,
): Promise<void> {
	let state: Record<string, unknown> = {};
	if (existsSync(stateFile)) {
		state = JSON.parse(await readFile(stateFile, "utf-8"));
	} else if (!existsSync(dirname(stateFile))) {
		// A missing config dir means this login was never set up — the CLI's
		// own onboarding (which includes trust) will run anyway.
		return;
	}
	const projects = (state.projects ?? {}) as Record<
		string,
		Record<string, unknown> | undefined
	>;
	// `false` is Claude's default scaffold value ("dialog never accepted"),
	// not a recorded decline — the CLI persists no decline state (declining
	// just exits). So overwriting false → true is the intended seed, unlike
	// Codex's explicit "untrusted", which is preserved below.
	const existing = projects[folderPath];
	if (existing?.hasTrustDialogAccepted === true) return;
	state.projects = {
		...projects,
		[folderPath]: { ...existing, hasTrustDialogAccepted: true },
	};
	await atomicWrite(stateFile, JSON.stringify(state, null, 2));
}

/**
 * True when the config already defines a `projects` entry for `folderPath`,
 * tolerating header spacing and both TOML string styles (plus top-level
 * dotted keys). Appending a duplicate table would make the whole file
 * unparseable for Codex, so detection must be broader than the exact header
 * Codex itself writes.
 */
function codexProjectEntryExists(content: string, folderPath: string): boolean {
	const entry =
		/^\s*\[?\s*projects\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*[\].]/;
	for (const line of content.split(/\r?\n/)) {
		const match = entry.exec(line);
		if (!match) continue;
		const key =
			match[1] !== undefined ? match[1].replace(/\\(["\\])/g, "$1") : match[2];
		if (key === folderPath) return true;
	}
	return false;
}

/**
 * Append a `[projects."<path>"]` table with `trust_level = "trusted"` to a
 * Codex config.toml. An existing entry for the path is left untouched — a
 * user's explicit "untrusted" must not be overridden.
 */
export async function seedCodexFolderTrust(
	configFile: string,
	folderPath: string,
): Promise<void> {
	let content = "";
	if (existsSync(configFile)) {
		content = await readFile(configFile, "utf-8");
		if (codexProjectEntryExists(content, folderPath)) return;
	} else if (!existsSync(dirname(configFile))) {
		return;
	}
	const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	const block = `[projects."${escaped}"]\ntrust_level = "trusted"\n`;
	const next =
		content.length === 0 ? block : `${content.replace(/\n*$/, "\n\n")}${block}`;
	await atomicWrite(configFile, next);
}

function normalizeFolderPathCandidates(folderPath: string): string[] {
	const raw = resolve(folderPath);
	const paths = new Set<string>([raw]);
	let real = raw;
	try {
		real = realpathSync(raw);
		paths.add(real);
	} catch {
		// Folder may not exist on disk yet; keep the resolved raw path.
	}
	// On macOS, /tmp is a symlink to /private/tmp; seed both aliases when they
	// resolve to the same directory so symlinked worktrees never miss trust.
	if (process.platform === "darwin" && real.startsWith("/private/tmp/")) {
		const tmpAlias = real.slice("/private".length);
		try {
			if (realpathSync(tmpAlias) === real) {
				paths.add(tmpAlias);
			}
		} catch {
			// Ignore if alias cannot be resolved.
		}
	}
	return [...paths];
}

const KIMI_MAX_WORKDIR_SLUG_LENGTH = 40;

function slugifyKimiWorkDirName(name: string): string {
	const slug = name
		.toLowerCase()
		.replaceAll(/[^a-z0-9._-]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
		.slice(0, KIMI_MAX_WORKDIR_SLUG_LENGTH)
		.replaceAll(/^-+|-+$/g, "");
	return slug === "" || slug === "." || slug === ".." ? "workspace" : slug;
}

export function encodeKimiWorkDirKey(workDir: string): string {
	const normalized = workDir.replaceAll("\\", "/").replace(/\/+$/, "");
	const slug = slugifyKimiWorkDirName(
		normalized.split("/").pop() ?? normalized,
	);
	const hash = createHash("sha256")
		.update(normalized)
		.digest("hex")
		.slice(0, 12);
	return `wd_${slug}_${hash}`;
}

/**
 * Write Kimi Code's per-folder trust record (`<trustDir>/wd_<slug>_<hash12>`)
 * for both raw and canonical realpath forms. Skips when Kimi's home directory
 * itself has not been created yet, and leaves existing records untouched.
 */
export async function seedKimiFolderTrust(
	trustDir: string,
	folderPath: string,
): Promise<void> {
	if (!existsSync(dirname(trustDir))) return;
	await mkdir(trustDir, { recursive: true, mode: 0o700 });
	for (const candidate of normalizeFolderPathCandidates(folderPath)) {
		const recordFile = join(trustDir, encodeKimiWorkDirKey(candidate));
		if (existsSync(recordFile)) continue;
		await atomicWrite(
			recordFile,
			JSON.stringify({ root: candidate, trustedAt: Date.now() }),
		);
	}
}

/**
 * Append `folderPath` (both raw and canonical realpath forms) to
 * `trustedWorkspaces` in Antigravity's settings.json, preserving every other
 * key. A corrupt file throws instead of being clobbered. No-op when all
 * normalized forms are already listed.
 */
export async function seedAgyFolderTrust(
	settingsFile: string,
	folderPath: string,
): Promise<void> {
	let settings: Record<string, unknown> = {};
	if (existsSync(settingsFile)) {
		settings = JSON.parse(await readFile(settingsFile, "utf-8"));
	} else if (!existsSync(dirname(settingsFile))) {
		return;
	}
	const trusted = Array.isArray(settings.trustedWorkspaces)
		? settings.trustedWorkspaces
		: [];
	const candidates = normalizeFolderPathCandidates(folderPath);
	const missing = candidates.filter(
		(candidate) => !trusted.includes(candidate),
	);
	if (missing.length === 0) return;
	settings.trustedWorkspaces = [...trusted, ...missing];
	await atomicWrite(settingsFile, JSON.stringify(settings, null, 2));
}

function normalizeFolderPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/**
 * Seed trust for `folderPath` in the launching agent's trust store, if it
 * has a known one. `config` is the already-resolved host agent config of the
 * agent about to launch. Best-effort: failures log and the dialog shows
 * once.
 */
export async function seedAgentFolderTrust(
	db: HostDb,
	folderPath: string,
	config: { presetId: string; command: string; env: Record<string, string> },
): Promise<void> {
	try {
		const target = resolveTrustTarget(db, config);
		if (target === null) return;
		const normalized = normalizeFolderPath(folderPath);
		if (target.family === "claude") {
			await seedClaudeFolderTrust(target.file, normalized);
		} else if (target.family === "agy") {
			await seedAgyFolderTrust(target.file, folderPath);
		} else if (target.family === "kimi") {
			await seedKimiFolderTrust(target.file, folderPath);
		} else {
			await seedCodexFolderTrust(target.file, normalized);
		}
	} catch (err) {
		console.warn(
			`[agents.run] failed to pre-trust session folder '${folderPath}' for agent '${config.presetId}':`,
			err,
		);
	}
}
