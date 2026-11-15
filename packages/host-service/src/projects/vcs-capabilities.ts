import { lstatSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { vcsCapabilities } from "@jedv/shared/vcs-capabilities";
import { TRPCError } from "@trpc/server";

/** Project imports use canonical roots; linked worktrees have a .git file.
 * Missing/unreadable metadata disables Git without starting a subprocess. */
export function hasGitMetadata(rootPath: string): boolean {
	try {
		const metadata = statSync(join(rootPath, ".git"));
		return metadata.isDirectory() || metadata.isFile();
	} catch {
		return false;
	}
}

/** Positive folder evidence, distinct from missing/inaccessible Git checkouts.
 * Any .git entry (including a dangling pointer/symlink) keeps Git error handling. */
export function isPlainDirectory(rootPath: string): boolean {
	try {
		if (!statSync(rootPath).isDirectory()) return false;
		try {
			lstatSync(join(rootPath, ".git"));
			return false;
		} catch (error) {
			return (
				(error as NodeJS.ErrnoException).code === "ENOENT" &&
				statSync(rootPath).isDirectory()
			);
		}
	} catch {
		return false;
	}
}

export function getVcsCapabilities(rootPath: string) {
	return vcsCapabilities(hasGitMetadata(rootPath) ? "git" : "none");
}

export function requireGitCapability(rootPath: string): void {
	if (!hasGitMetadata(rootPath)) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Git, pull requests and worktrees are unavailable for this folder. Use an existing workspace to run terminals or Team members.",
			cause: { kind: "VCS_UNAVAILABLE", vcsKind: "none" },
		});
	}
}

/** Import preview may start inside a repository; importing canonical roots is unchanged. */
export function hasGitMetadataAbove(path: string): boolean {
	for (let current = path; ; current = dirname(current)) {
		if (hasGitMetadata(current)) return true;
		if (dirname(current) === current) return false;
	}
}
