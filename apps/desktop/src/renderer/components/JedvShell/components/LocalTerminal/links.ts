import type { LinkHoverInfo } from "renderer/lib/terminal/terminal-runtime-registry";
import type { TerminalLinkMenuItem } from "./link-menu";

const entries = new Map<string, LinkHoverInfo | null>();
const actions = new Map<
	string,
	(link: LinkHoverInfo) => TerminalLinkMenuItem[]
>();
export const terminalContextMenuLinkStore = {
	record: (paneId: string, link: LinkHoverInfo | null) =>
		entries.set(paneId, link),
	get: (paneId: string) => entries.get(paneId) ?? null,
	setActions: (
		paneId: string,
		build: (link: LinkHoverInfo) => TerminalLinkMenuItem[],
	) => actions.set(paneId, build),
	getActions: (paneId: string): TerminalLinkMenuItem[] => {
		const link = entries.get(paneId);
		return link ? (actions.get(paneId)?.(link) ?? []) : [];
	},
	clear: (paneId: string) => {
		entries.delete(paneId);
		actions.delete(paneId);
	},
};
