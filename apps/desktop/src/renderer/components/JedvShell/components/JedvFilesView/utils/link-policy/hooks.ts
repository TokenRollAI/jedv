import { useCallback } from "react";
import { useSettings } from "renderer/stores/settings";
import {
	resolveFileLinkAction,
	resolveFolderLinkAction,
	resolveUrlLinkAction,
} from "./resolve";
import type { ModifierEvent, TierMode, UrlLinkAction } from "./types";

export function useUrlLinkAction(mode: TierMode): UrlLinkAction {
	const map = useSettings((state) => state.urlLinks);
	return useCallback(
		(event) => resolveUrlLinkAction(map, event, mode),
		[map, mode],
	);
}

export function useFileLinkAction(
	mode: TierMode,
	{ remote, sidebar = false }: { remote: boolean; sidebar?: boolean },
) {
	const map = useSettings((state) =>
		sidebar ? state.sidebarFileLinks : state.fileLinks,
	);
	return useCallback(
		(event: ModifierEvent) => resolveFileLinkAction(map, event, mode, remote),
		[map, mode, remote],
	);
}

export function useFolderLinkAction({ remote }: { remote: boolean }) {
	const map = useSettings((state) => state.folderLinks);
	return useCallback(
		(event: ModifierEvent) => resolveFolderLinkAction(map, event, remote),
		[map, remote],
	);
}
