import { splitPath } from "renderer/lib/splitPath";

export function renameSourceLabel(path: string, oldPath: string): string {
	const old = splitPath(oldPath);
	return old.name === splitPath(path).name ? old.dir : old.name;
}
