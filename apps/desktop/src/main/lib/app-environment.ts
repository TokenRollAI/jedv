import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveAppHomeDir, resolveUserHomeDir } from "@jedv/agent-setup/paths";
import { getWorkspaceName } from "shared/env.shared";

const workspace = getWorkspaceName();
const inheritedHome = process.env.JEDV_HOME_DIR?.trim();
if (!inheritedHome || /^\.jedv(?:-|$)/.test(basename(inheritedHome))) {
	process.env.JEDV_HOME_DIR = join(
		resolveUserHomeDir(),
		workspace ? `.jedv-${workspace}` : ".jedv",
	);
}

export const JEDV_HOME_DIR = resolveAppHomeDir();

export const JEDV_HOME_DIR_MODE = 0o700;
export const JEDV_SENSITIVE_FILE_MODE = 0o600;

export function ensureJedvHomeDirExists(): void {
	if (!existsSync(JEDV_HOME_DIR)) {
		mkdirSync(JEDV_HOME_DIR, {
			recursive: true,
			mode: JEDV_HOME_DIR_MODE,
		});
	}

	// Best-effort repair if the directory already existed with weak permissions.
	try {
		chmodSync(JEDV_HOME_DIR, JEDV_HOME_DIR_MODE);
	} catch (error) {
		console.warn(
			"[app-environment] Failed to chmod Jedv home dir (best-effort):",
			JEDV_HOME_DIR,
			error,
		);
	}
}

// For lowdb - use our own path instead of app.getPath("userData")
export const APP_STATE_PATH = join(JEDV_HOME_DIR, "app-state.json");

// Window geometry state (separate from UI state - main process only, sync I/O)
export const WINDOW_STATE_PATH = join(JEDV_HOME_DIR, "window-state.json");
