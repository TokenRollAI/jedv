import { existsSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_PROJECT_CONFIG_DIRS, PROJECT_CONFIG_DIR } from "./constants";

const MAIN_CONFIG_FILES = ["config.toml", "config.json"];
const OTHER_CONFIG_FILES = [
	"config.local.toml",
	"config.local.json",
	"ports.json",
	"setup.sh",
	"teardown.sh",
	"run.sh",
	"start.sh",
];

function hasAny(dir: string, files: string[]): boolean {
	return files.some((file) => existsSync(join(dir, file)));
}

export function resolveProjectConfigDirName(root: string): string {
	for (const files of [MAIN_CONFIG_FILES, OTHER_CONFIG_FILES]) {
		for (const dir of [PROJECT_CONFIG_DIR, ...LEGACY_PROJECT_CONFIG_DIRS]) {
			if (hasAny(join(root, dir), files)) return dir;
		}
	}
	return PROJECT_CONFIG_DIR;
}

export function resolveProjectConfigDir(root: string): string {
	return join(root, resolveProjectConfigDirName(root));
}
