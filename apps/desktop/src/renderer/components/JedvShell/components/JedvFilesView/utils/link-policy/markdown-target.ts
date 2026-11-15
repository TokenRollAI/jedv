import { resolveWorkspaceFilePath } from "../workspace-path";

export function markdownFileTarget(
	root: string,
	documentPath: string,
	href: string,
): string | null {
	if (!href || href.startsWith("#")) return null;
	try {
		const base = new URL("file:///");
		base.pathname = documentPath.replaceAll("\\", "/");
		const target = new URL(href, base);
		if (
			target.protocol !== "file:" ||
			(target.hostname && target.hostname !== "localhost") ||
			target.username ||
			target.password
		)
			return null;
		let path = decodeURIComponent(target.pathname);
		if (/^[a-z]:/i.test(root) && /^\/[a-z]:/i.test(path)) path = path.slice(1);
		return resolveWorkspaceFilePath(root, path);
	} catch {
		return null;
	}
}
