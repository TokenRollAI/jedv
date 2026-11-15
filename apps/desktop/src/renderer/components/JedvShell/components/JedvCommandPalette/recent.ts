const MAX_RECENT_COMMANDS = 10;
const MAX_RECENT_FILES = 20;
let commandIds: string[] = [];
let files: { hostUrl: string; workspaceId: string; path: string }[] = [];
export function rememberCommand(id: string) {
	commandIds = [id, ...commandIds.filter((known) => known !== id)].slice(
		0,
		MAX_RECENT_COMMANDS,
	);
}
export function recentCommands() {
	return commandIds;
}
export function rememberPaletteFile(
	hostUrl: string,
	workspaceId: string,
	path: string,
) {
	files = [
		{ hostUrl, workspaceId, path },
		...files.filter(
			(file) =>
				file.hostUrl !== hostUrl ||
				file.workspaceId !== workspaceId ||
				file.path !== path,
		),
	].slice(0, MAX_RECENT_FILES);
}
export function recentPaletteFiles(
	hostUrl: string,
	workspaceId: string | null,
) {
	return files.filter(
		(file) => file.hostUrl === hostUrl && file.workspaceId === workspaceId,
	);
}
