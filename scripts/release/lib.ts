import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import semver from "semver";

export const DESKTOP_PACKAGE = "apps/desktop";
export const UNIFIED_PACKAGES = ["packages/host-service", "packages/cli"];

export function isPlainRelease(version: string): boolean {
	return /^\d+\.\d+\.\d+$/.test(version);
}

export function unifiedErrors(
	desktop: string,
	entries: { name: string; version: string }[],
): string[] {
	const errors: string[] = [];
	if (!isPlainRelease(desktop)) {
		errors.push(
			`desktop version '${desktop}' is not a plain MAJOR.MINOR.PATCH release`,
		);
	}
	let first: string | undefined;
	for (const { name, version } of entries) {
		if (!isPlainRelease(version)) {
			errors.push(
				`${name} '${version}' must be plain MAJOR.MINOR.PATCH (no prerelease suffix — suffixes fail the host-service min-version floor)`,
			);
		}
		if (first === undefined) first = version;
		else if (version !== first) {
			errors.push(
				`${name} '${version}' != '${first}' (unified packages must match)`,
			);
		}
	}
	if (first && isPlainRelease(first) && isPlainRelease(desktop)) {
		if (semver.lt(first, desktop)) {
			errors.push(`cli/host '${first}' is below desktop '${desktop}'`);
		} else if (
			semver.major(first) !== semver.major(desktop) ||
			semver.minor(first) !== semver.minor(desktop)
		) {
			errors.push(
				`cli/host '${first}' must stay in desktop '${desktop}' minor line (patch-ahead only)`,
			);
		}
	}
	return errors;
}

export async function repoRoot(): Promise<string> {
	return (await $`git rev-parse --show-toplevel`.text()).trim();
}

export function readVersion(root: string, pkgDir: string): string {
	return JSON.parse(readFileSync(join(root, pkgDir, "package.json"), "utf8"))
		.version;
}

export async function assertUnified(root: string): Promise<{
	desktop: string;
	entries: { name: string; version: string }[];
	errors: string[];
}> {
	const desktop = readVersion(root, DESKTOP_PACKAGE);
	const entries = UNIFIED_PACKAGES.map((name) => ({
		name,
		version: readVersion(root, name),
	}));
	return { desktop, entries, errors: unifiedErrors(desktop, entries) };
}
