import type { findNestedRepoRoots } from "@jedv/workspace-fs/watch-scan";
import { hasGitMetadata } from "../../projects/vcs-capabilities";
import { getHostWorkerPool } from "../../workers/host-worker-pool.ts";
import {
	gitDirectoryTask,
	ignoredDirectoriesTask,
	nestedRepositoriesTask,
} from "../../workers/tasks/watcher.ts";

export const scanNestedRepositories: typeof findNestedRepoRoots = (
	rootPath,
	{ signal, now: _now, ...options },
) =>
	getHostWorkerPool().run(
		nestedRepositoriesTask,
		{ rootPath, options },
		{ signal },
	);

export function scanGitIgnoredDirectories(
	rootPath: string,
	signal?: AbortSignal,
): Promise<string[]> {
	if (!hasGitMetadata(rootPath)) return Promise.resolve([]);
	return getHostWorkerPool().run(
		ignoredDirectoriesTask,
		{ rootPath },
		{ signal },
	);
}

export function resolveGitDirectory(
	rootPath: string,
	signal: AbortSignal,
): Promise<string | null> {
	return getHostWorkerPool().run(gitDirectoryTask, { rootPath }, { signal });
}
