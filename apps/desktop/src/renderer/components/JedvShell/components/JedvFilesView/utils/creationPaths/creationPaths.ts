import { toAbs } from "../treePath";

export function deriveCreationParent(
	selectedTreePaths: readonly string[],
	knownPaths: Set<string>,
	rootPath: string,
): string {
	const selected = selectedTreePaths[selectedTreePaths.length - 1];
	if (!selected) return rootPath;
	if (selected.endsWith("/")) {
		return knownPaths.has(selected) ? toAbs(rootPath, selected) : rootPath;
	}

	const lastSlash = selected.lastIndexOf("/");
	if (lastSlash < 0) return rootPath;

	const parentRelPath = selected.slice(0, lastSlash);
	return knownPaths.has(`${parentRelPath}/`)
		? toAbs(rootPath, parentRelPath)
		: rootPath;
}

export const CREATION_BASE_NAME = {
	folder: "Untitled",
	file: "untitled",
} as const;

export function buildCreationKey(
	parentRel: string,
	name: string,
	mode: "file" | "folder",
): string {
	const prefix = parentRel ? `${parentRel}/` : "";
	return `${prefix}${name}${mode === "folder" ? "/" : ""}`;
}
