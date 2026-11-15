import type {
	FileTreeDirectoryHandle,
	FileTreeItemHandle,
} from "@pierre/trees";
import { stripTrailingSlash } from "renderer/lib/pierreTree";

import { withinWorkspace } from "../workspace-path";

export { stripTrailingSlash };

export function toPosix(p: string): string {
	return p.replace(/\\/g, "/");
}

export function toRel(rootPath: string, abs: string): string {
	const a = toPosix(abs);
	const r = toPosix(rootPath);
	if (a === r) return "";
	if (a.startsWith(`${r}/`)) return a.slice(r.length + 1);
	return a;
}

export function toAbs(rootPath: string, rel: string): string {
	const trimmed = stripTrailingSlash(rel);
	const absolutePath = trimmed
		? `${rootPath.replace(/\/$/, "")}/${trimmed}`
		: rootPath;
	if (!withinWorkspace(rootPath, absolutePath))
		throw new Error("This file is outside the workspace");
	return absolutePath;
}

export function parentRel(rel: string): string {
	const trimmed = stripTrailingSlash(rel);
	const i = trimmed.lastIndexOf("/");
	return i < 0 ? "" : trimmed.slice(0, i);
}

export function basename(rel: string): string {
	const trimmed = stripTrailingSlash(rel);
	const i = trimmed.lastIndexOf("/");
	return i < 0 ? trimmed : trimmed.slice(i + 1);
}

export function moveDestinationPath(
	sourcePath: string,
	directoryPath: string | null,
): string {
	const directory = stripTrailingSlash(directoryPath ?? "");
	const name = basename(sourcePath);
	const destination = directory ? `${directory}/${name}` : name;
	return sourcePath.endsWith("/") ? `${destination}/` : destination;
}

export function resolveDeleteTreePath(
	known: Set<string>,
	rel: string,
	isDirectory: boolean | undefined,
): { treePath: string; isDirectory: boolean } {
	const directoryPath = `${rel}/`;
	const resolvedIsDirectory = known.has(directoryPath)
		? true
		: known.has(rel)
			? false
			: isDirectory === true;
	const treePath = resolvedIsDirectory ? directoryPath : rel;
	return {
		treePath,
		isDirectory: resolvedIsDirectory,
	};
}
export function asDirectoryHandle(
	handle: FileTreeItemHandle | null,
): FileTreeDirectoryHandle | null {
	return handle?.isDirectory() ? (handle as FileTreeDirectoryHandle) : null;
}
