/**
 * V2 terminal environment contract.
 *
 * PTY env is built from a preserved shell snapshot resolved by the host-service
 * at startup — never from desktop main or the live host-service process.env.
 */

export { stripTerminalRuntimeEnv } from "./env-strip.ts";
export type {
	ShellBootstrapParams,
	ShellLaunchParams,
} from "./shell-launch.ts";
export {
	getJedvShellPaths,
	getShellBootstrapEnv,
	getShellLaunchArgs,
	resolveLaunchShell,
	shellLaunchExpectsReadyMarker,
} from "./shell-launch.ts";

import fs from "node:fs";
import os from "node:os";
import { resolveAppHomeDir } from "@jedv/agent-setup";
import { TERMINAL_IDENTITY_ENV_KEYS } from "@jedv/shared/constants";
import {
	augmentPathForMacOS,
	clearStrictShellEnvCache,
	getStrictShellEnvironment,
} from "./clean-shell-env.ts";
import { stripTerminalRuntimeEnv } from "./env-strip.ts";
import { getShellBootstrapEnv, resolveLaunchShell } from "./shell-launch.ts";

const MACOS_SYSTEM_CERT_FILE = "/etc/ssl/cert.pem";
let cachedMacosSystemCertAvailable: boolean | null = null;

function hasMacosSystemCertBundle(): boolean {
	if (cachedMacosSystemCertAvailable !== null) {
		return cachedMacosSystemCertAvailable;
	}
	cachedMacosSystemCertAvailable = fs.existsSync(MACOS_SYSTEM_CERT_FILE);
	return cachedMacosSystemCertAvailable;
}

// ── Shell snapshot preservation ──────────────────────────────────────

let _terminalBaseEnv: Record<string, string> | null = null;

function snapshotStringEnv(
	baseEnv: NodeJS.ProcessEnv | Record<string, string> = process.env,
): Record<string, string> {
	const snapshot: Record<string, string> = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (typeof value === "string") {
			snapshot[key] = value;
		}
	}
	return snapshot;
}

/**
 * Resolve the shell-derived terminal base env inside the host-service process.
 * Desktop main should not construct or own this snapshot.
 *
 * Falls back to a process.env snapshot if the user's login shell can't be
 * probed — crashing host-service startup over a degraded PTY env strands
 * users on v2. v1 desktop main does the same in apps/desktop shell-env.ts.
 */
export async function resolveTerminalBaseEnv(): Promise<
	Record<string, string>
> {
	try {
		return await getStrictShellEnvironment();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`[host-service] Shell env snapshot failed, falling back to process.env: ${message}`,
		);
		const fallback = snapshotStringEnv(process.env);
		augmentPathForMacOS(fallback);
		return fallback;
	}
}

/**
 * Capture the terminal base env at host-service startup.
 *
 * Accepts an explicit shell snapshot for the real startup path, but retains a
 * process.env fallback for tests and local helpers.
 */
export function initTerminalBaseEnv(baseEnv?: Record<string, string>): void {
	_terminalBaseEnv = stripTerminalRuntimeEnv(snapshotStringEnv(baseEnv));
}

export function getTerminalBaseEnv(): Record<string, string> {
	if (!_terminalBaseEnv) {
		throw new Error(
			"Terminal base env not initialized. Call initTerminalBaseEnv() at host-service startup.",
		);
	}
	return { ..._terminalBaseEnv };
}

let _terminalBaseEnvReady: Promise<void> | null = null;

/**
 * Kick off the shell-env snapshot in the background and stash it once resolved.
 *
 * Startup must NOT await this. The login-shell probe can take up to
 * SHELL_ENV_TIMEOUT_MS (8s) — often the full budget when the user's shell is
 * slow (e.g. a wedged powerlevel10k/gitstatus init) — and gating the HTTP
 * listen on it pushes cold starts past the desktop coordinator's health-check
 * window, especially when every org boots at once. PTY creation awaits
 * `waitForTerminalBaseEnv()` instead, so terminals still get the preserved
 * snapshot without blocking the server from becoming reachable.
 */
export function startTerminalBaseEnvResolution(): void {
	if (_terminalBaseEnvReady) return;
	const promise = resolveTerminalBaseEnv().then((baseEnv) => {
		// Ignore a stale resolution whose gate was already reset (tests) so it
		// can't clobber fresh state.
		if (_terminalBaseEnvReady === promise) initTerminalBaseEnv(baseEnv);
	});
	// Fire-and-forget: nothing awaits the gate until the first PTY is created,
	// so swallow a background failure rather than crash on an unhandled
	// rejection. resolveTerminalBaseEnv already falls back internally.
	promise.catch((err) => {
		console.warn("[host-service] terminal base env resolution failed:", err);
	});
	_terminalBaseEnvReady = promise;
}

/**
 * Await the background shell-env snapshot before reading getTerminalBaseEnv().
 * Resolves immediately when resolution was never started (tests and helpers
 * that call initTerminalBaseEnv() directly).
 */
export async function waitForTerminalBaseEnv(): Promise<void> {
	if (_terminalBaseEnvReady) await _terminalBaseEnvReady;
}

export function resetTerminalBaseEnvForTests(): void {
	_terminalBaseEnv = null;
	_terminalBaseEnvReady = null;
	cachedMacosSystemCertAvailable = null;
	clearStrictShellEnvCache();
}

// ── Locale ───────────────────────────────────────────────────────────

const UTF8_RE = /utf-?8/i;

/** POSIX precedence: LC_ALL overrides LANG. Matches utf8/UTF-8/UTF8. */
export function normalizeUtf8Locale(baseEnv: Record<string, string>): string {
	if (baseEnv.LC_ALL && UTF8_RE.test(baseEnv.LC_ALL)) return baseEnv.LC_ALL;
	if (baseEnv.LANG && UTF8_RE.test(baseEnv.LANG)) return baseEnv.LANG;
	return "en_US.UTF-8";
}

// ── V2 terminal env construction ─────────────────────────────────────

interface BuildV2TerminalEnvParams {
	baseEnv: Record<string, string>;
	shell: string;
	jedvHomeDir: string;
	organizationId: string;
	themeType?: "dark" | "light";
	cwd: string;
	terminalId: string;
	workspaceId: string;
	workspacePath: string;
	rootPath: string;
	jedvEnv: "development" | "production";
	agentHookPort: string;
	agentHookVersion: string;
	/**
	 * tRPC URL for the host-service notifications.hook mutation.
	 * Endpoint is unauthenticated by design — it broadcasts chimes and
	 * nudges the workspace's linked task to In Progress (idempotent,
	 * forward-only). See the router for rationale.
	 */
	hostAgentHookUrl?: string;
}

/**
 * The env for anything this host launches on the user's behalf, PTY or not.
 * Everything a caller cannot know better than the host — the shell snapshot,
 * the launch shell, the org and run mode — is filled in here so a second
 * launch path cannot drift from the terminal's.
 */
export function buildHostLaunchEnv(params: {
	cwd: string;
	workspaceId: string;
	workspacePath: string;
	rootPath: string;
	terminalId?: string;
	themeType?: "dark" | "light";
	hostAgentHookUrl?: string;
}): Record<string, string> {
	const baseEnv = getTerminalBaseEnv();
	return buildV2TerminalEnv({
		baseEnv,
		shell: resolveLaunchShell(baseEnv),
		jedvHomeDir: resolveAppHomeDir(),
		organizationId: process.env.ORGANIZATION_ID || "",
		themeType: params.themeType,
		cwd: params.cwd,
		terminalId: params.terminalId ?? "",
		workspaceId: params.workspaceId,
		workspacePath: params.workspacePath,
		rootPath: params.rootPath,
		jedvEnv:
			process.env.NODE_ENV === "development" ? "development" : "production",
		agentHookPort: process.env.JEDV_AGENT_HOOK_PORT || "",
		agentHookVersion: process.env.JEDV_AGENT_HOOK_VERSION || "",
		hostAgentHookUrl: params.hostAgentHookUrl,
	});
}

/**
 * Build the final v2 PTY environment.
 * baseEnv must be the preserved shell snapshot from getTerminalBaseEnv().
 */
export function buildV2TerminalEnv(
	params: BuildV2TerminalEnvParams,
): Record<string, string> {
	const {
		baseEnv,
		shell,
		jedvHomeDir,
		organizationId,
		themeType,
		cwd,
		terminalId,
		workspaceId,
		workspacePath,
		rootPath,
		jedvEnv,
		agentHookPort,
		agentHookVersion,
		hostAgentHookUrl,
	} = params;

	// Defense in depth — baseEnv is pre-stripped at init, but strip again
	// to guarantee no runtime keys reach PTYs regardless of call site
	const env = stripTerminalRuntimeEnv(baseEnv);

	Object.assign(env, getShellBootstrapEnv({ shell, baseEnv, jedvHomeDir }));

	env.TERM = "xterm-256color";
	env.SHELL = shell;
	for (const key of TERMINAL_IDENTITY_ENV_KEYS) delete env[key];
	env.COLORTERM = "truecolor";
	env.COLORFGBG = themeType === "light" ? "0;15" : "15;0";
	// TERM_THEME is an explicit light/dark hint that cursor-agent (and other
	// TUIs) read before falling back to an OSC 11 background probe. Our PTY
	// output round-trips through the renderer's xterm, so that probe routinely
	// exceeds cursor-agent's ~100ms timeout and defaults to dark on a light
	// theme. Setting it here resolves the theme without the probe race.
	env.TERM_THEME = themeType === "light" ? "light" : "dark";
	env.LANG = normalizeUtf8Locale(baseEnv);
	env.PWD = cwd;

	env.JEDV_TERMINAL_ID = terminalId;
	// Scope CLI commands launched in this terminal to the same organization as
	// the org-specific host-service that owns the workspace. This is routing
	// metadata, not a credential; the CLI still uses its own authenticated
	// session, but no longer consults that session's unrelated active-org choice.
	if (organizationId) {
		env.JEDV_ORGANIZATION_ID = organizationId;
	}
	env.JEDV_WORKSPACE_ID = workspaceId;
	env.JEDV_WORKSPACE_PATH = workspacePath;
	env.JEDV_ROOT_PATH = rootPath;
	env.JEDV_ENV = jedvEnv;
	env.JEDV_AGENT_HOOK_PORT = agentHookPort;
	env.JEDV_AGENT_HOOK_VERSION = agentHookVersion;
	// v2 — agent posts to host-service so the renderer can play the sound
	// client-side. No auth token: the endpoint is unauthenticated by design
	// (chimes plus an idempotent linked-task In Progress nudge). The
	// notify-hook script falls back to the electron endpoint when this URL
	// isn't set.
	if (hostAgentHookUrl) {
		env.JEDV_HOST_AGENT_HOOK_URL = hostAgentHookUrl;
	}

	if (jedvHomeDir) {
		env.JEDV_HOME_DIR = jedvHomeDir;
	}

	// Electron child processes can't access macOS Keychain for TLS cert verification,
	// causing "x509: OSStatus -26276" in Go binaries like `gh`. File-based fallback.
	if (
		os.platform() === "darwin" &&
		!env.SSL_CERT_FILE &&
		hasMacosSystemCertBundle()
	) {
		env.SSL_CERT_FILE = MACOS_SYSTEM_CERT_FILE;
	}

	return env;
}
