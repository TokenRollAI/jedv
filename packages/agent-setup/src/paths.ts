import os from "node:os";
import path from "node:path";

export const APP_HOME_DIR_NAME = ".jedv";

/**
 * The one home directory resolver for every process that provisions or
 * consumes the app's per-machine files (Electron main, host-service, CLI,
 * pty daemon). Resolved lazily because the desktop rewrites JEDV_HOME_DIR
 * into process.env during boot, and headless hosts may not have it set at all.
 */
export function resolveAppHomeDir(): string {
	return process.env.JEDV_HOME_DIR?.trim() || defaultAppHomeDir();
}

export function defaultAppHomeDir(): string {
	return path.join(resolveUserHomeDir(), APP_HOME_DIR_NAME);
}

export function isDefaultAppHomeDir(dir: string | undefined): boolean {
	// The legacy daemon namespace belongs to the OS user's real home. A test
	// user-home override must never make its temporary .jedv share that socket.
	const nativeHome =
		process.platform === "win32"
			? os.homedir()
			: process.env.HOME || os.homedir();
	return (
		!dir?.trim() ||
		path.resolve(dir) === path.join(nativeHome, APP_HOME_DIR_NAME)
	);
}

/**
 * Node reads $HOME on every os.homedir() call on POSIX; bun reads it once at
 * startup. Reading it here keeps both runtimes the same.
 */
export function resolveUserHomeDir(): string {
	const override = process.env.JEDV_USER_HOME_DIR?.trim();
	if (override) return path.resolve(override);
	if (process.platform === "win32") return os.homedir();
	return process.env.HOME || os.homedir();
}

export function getBinDir(): string {
	return path.join(resolveAppHomeDir(), "bin");
}

export function getHooksDir(): string {
	return path.join(resolveAppHomeDir(), "hooks");
}

export function getZshDir(): string {
	return path.join(resolveAppHomeDir(), "zsh");
}

export function getBashDir(): string {
	return path.join(resolveAppHomeDir(), "bash");
}

export function getOpenCodeConfigDir(): string {
	return path.join(getHooksDir(), "opencode");
}

export function getOpenCodePluginDir(): string {
	return path.join(getOpenCodeConfigDir(), "plugin");
}

/** OpenCode V2's TUI only discovers plugin directories under `plugins/`. */
export function getOpenCodeTuiPluginDir(): string {
	return path.join(getOpenCodeConfigDir(), "plugins", "jedv-notify");
}
