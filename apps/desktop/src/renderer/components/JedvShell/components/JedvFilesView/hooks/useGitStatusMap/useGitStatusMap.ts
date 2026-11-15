import { useMemo } from "react";
import type { LocalClient } from "renderer/components/JedvShell/local-client";

type GitStatusData = Awaited<
	ReturnType<LocalClient["git"]["getStatus"]["query"]>
>;
type ChangedFile = GitStatusData["againstBase"][number];
export type FileStatus = ChangedFile["status"];

export interface UseGitStatusMapResult {
	fileStatusByPath: Map<string, FileStatus>;
	folderStatusByPath: Map<string, FileStatus>;
	ignoredPaths: Set<string>;
}

const STATUS_SEVERITY: Record<FileStatus, number> = {
	deleted: 5,
	modified: 4,
	changed: 4,
	added: 3,
	untracked: 2,
	renamed: 1,
	copied: 0,
};

function emptyResult(): UseGitStatusMapResult {
	return {
		fileStatusByPath: new Map(),
		folderStatusByPath: new Map(),
		ignoredPaths: new Set(),
	};
}

export function useGitStatusMap(
	status: GitStatusData | undefined,
): UseGitStatusMapResult {
	return useMemo(() => {
		if (!status) return emptyResult();
		const fileStatusByPath = new Map<string, FileStatus>();
		for (const file of status.againstBase) {
			fileStatusByPath.set(normalizePath(file.path), file.status);
		}
		for (const file of status.staged) {
			fileStatusByPath.set(normalizePath(file.path), file.status);
		}
		for (const file of status.unstaged) {
			fileStatusByPath.set(normalizePath(file.path), file.status);
		}

		const folderStatusByPath = new Map<string, FileStatus>();
		for (const [path, fileStatus] of fileStatusByPath) {
			if (fileStatus === "deleted") continue;

			const segments = path.split("/");
			for (let i = 1; i < segments.length; i++) {
				const ancestor = segments.slice(0, i).join("/");
				const existing = folderStatusByPath.get(ancestor);
				if (
					!existing ||
					STATUS_SEVERITY[fileStatus] > STATUS_SEVERITY[existing]
				) {
					folderStatusByPath.set(ancestor, fileStatus);
				}
			}
		}

		const ignoredPaths = new Set<string>();
		for (const entry of status.ignoredPaths) {
			ignoredPaths.add(normalizePath(entry).replace(/\/$/, ""));
		}

		return {
			fileStatusByPath,
			folderStatusByPath,
			ignoredPaths,
		};
	}, [status]);
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}
