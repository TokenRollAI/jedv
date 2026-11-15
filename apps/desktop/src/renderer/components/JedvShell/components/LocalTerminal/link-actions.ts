import type { LinkHoverInfo } from "renderer/lib/terminal/terminal-runtime-registry";
import {
	resolveFileLinkAction,
	resolveFolderLinkAction,
	resolveUrlLinkAction,
} from "../JedvFilesView/utils/link-policy/resolve";
import type {
	FolderLinkAction,
	LinkAction,
	LinkSettings,
	ModifierEvent,
} from "../JedvFilesView/utils/link-policy/types";

export type TerminalLinkAction = LinkAction | FolderLinkAction;
export type TerminalLinkHandlers = {
	remote: boolean;
	onOpenFile?(path: string, pinned?: boolean): void | Promise<void>;
	onOpenUrl?(url: string, placement?: LinkAction): void | Promise<void>;
	openEditor(path: string, line?: number, column?: number): Promise<unknown>;
	openFinder(path: string): Promise<unknown>;
	openExternalUrl(url: string): Promise<unknown>;
};

export function resolveTerminalLinkAction(
	link: LinkHoverInfo,
	settings: LinkSettings,
	event: ModifierEvent,
	remote: boolean,
): TerminalLinkAction | null {
	if (link.kind === "url")
		return resolveUrlLinkAction(settings.urlLinks, event, "4-tier");
	if (!link.resolvedPath) return null;
	return link.isDirectory
		? resolveFolderLinkAction(settings.folderLinks, event, remote)
		: resolveFileLinkAction(settings.fileLinks, event, "4-tier", remote);
}

export function canOpenTerminalLink(
	link: LinkHoverInfo,
	action: TerminalLinkAction,
	handlers: Pick<TerminalLinkHandlers, "remote" | "onOpenFile" | "onOpenUrl">,
): boolean {
	if (link.kind === "url") {
		if (!["pane", "newTab", "external", "rightPane"].includes(action))
			return false;
		try {
			const protocol = new URL(link.url).protocol;
			if (
				protocol !== "http:" &&
				protocol !== "https:" &&
				protocol !== "mailto:"
			)
				return false;
			if (protocol === "mailto:" && action !== "external") return false;
		} catch {
			return false;
		}
		return action === "external" || !!handlers.onOpenUrl;
	}
	if (!link.resolvedPath) return false;
	if (action === "external" || action === "finder") return !handlers.remote;
	if (!handlers.onOpenFile) return false;
	return link.isDirectory
		? action === "reveal"
		: action === "pane" || action === "newTab";
}

export async function openTerminalLink(
	link: LinkHoverInfo,
	action: TerminalLinkAction,
	handlers: TerminalLinkHandlers,
): Promise<boolean> {
	if (!canOpenTerminalLink(link, action, handlers)) return false;
	if (link.kind === "url") {
		if (handlers.onOpenUrl) await handlers.onOpenUrl(link.url, "external");
		else await handlers.openExternalUrl(link.url);
	} else if (link.resolvedPath) {
		if (action === "external")
			await handlers.openEditor(link.resolvedPath, link.row, link.col);
		else if (action === "finder") await handlers.openFinder(link.resolvedPath);
		else await handlers.onOpenFile?.(link.resolvedPath, action === "newTab");
	}
	return true;
}
