import {
	FILE_STATUS_TO_PIERRE,
	type PierreGitStatusEntry,
} from "renderer/lib/pierreTree";
import type { FileStatus } from "../../hooks/useGitStatusMap";

export function buildPierreGitStatus(
	fileStatusByPath: Map<string, FileStatus>,
	folderStatusByPath: Map<string, FileStatus>,
	ignoredPaths: Set<string>,
): PierreGitStatusEntry[] {
	const entries: PierreGitStatusEntry[] = [];
	for (const [path, status] of fileStatusByPath) {
		entries.push({ path, status: FILE_STATUS_TO_PIERRE[status] });
	}
	for (const [path, status] of folderStatusByPath) {
		entries.push({ path: `${path}/`, status: FILE_STATUS_TO_PIERRE[status] });
	}
	for (const path of ignoredPaths) {
		entries.push({ path, status: "ignored" });
	}
	return entries;
}
