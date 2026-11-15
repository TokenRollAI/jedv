import {
	isAbsoluteFilesystemPath,
	toAbsoluteWorkspacePath,
} from "shared/absolute-paths";

export function resolveWorkspaceFilePath(
	root: string,
	path: string,
): string | null {
	if (!isAbsoluteFilesystemPath(root) || !path || path.includes("\0"))
		return null;
	const filePath = path.replace(/^(?:\.\/|\.\\)+/, "");
	if (
		(/^[a-z]:/i.test(filePath) && !/^[a-z]:[\\/]/i.test(filePath)) ||
		/^\\(?!\\)/.test(filePath)
	)
		return null;
	const absolutePath = toAbsoluteWorkspacePath(root, filePath);
	return withinWorkspace(root, absolutePath) ? absolutePath : null;
}

export function withinWorkspace(root: string, path: string): boolean {
	const clean = root.replaceAll("\\", "/").replace(/\/$/, "");
	const normalized = path.replaceAll("\\", "/");
	return (
		(normalized === clean || normalized.startsWith(`${clean}/`)) &&
		!normalized.split("/").some((part) => part === ".." || part === ".")
	);
}

export function workspaceRelativePath(
	root: string,
	path: string,
): string | null {
	return withinWorkspace(root, path)
		? path
				.replaceAll("\\", "/")
				.slice(root.replaceAll("\\", "/").replace(/\/$/, "").length)
				.replace(/^\//, "")
		: null;
}
