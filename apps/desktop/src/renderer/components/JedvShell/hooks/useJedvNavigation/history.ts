import type { JedvSurface } from "../../parity-types";
export interface ShellLocation {
	hostUrl: string | null;
	workspaceId: string | null;
	terminalId: string | null;
	surface: JedvSurface;
	path?: string;
	pinned?: boolean;
}
export interface ShellHistory {
	entries: ShellLocation[];
	index: number;
}
export function pushShellLocation(
	history: ShellHistory,
	location: ShellLocation,
) {
	const current = history.entries[history.index];
	if (
		current &&
		current.hostUrl === location.hostUrl &&
		current.workspaceId === location.workspaceId &&
		current.surface === location.surface &&
		current.path === location.path
	)
		return;
	history.entries = [
		...history.entries.slice(0, history.index + 1),
		location,
	].slice(-64);
	history.index = history.entries.length - 1;
}
export function historyLocation(history: ShellHistory, direction: -1 | 1) {
	const index = history.index + direction;
	return index >= 0 && index < history.entries.length
		? { location: history.entries[index], index }
		: null;
}
