export type LinkAction = "pane" | "newTab" | "external" | "rightPane";
export type LinkTier = "plain" | "shift" | "meta" | "metaShift";
export type LinkTierMap = Record<LinkTier, LinkAction | null>;
export type FolderLinkAction = "reveal" | "external" | "finder";
export type FolderTierMap = Record<LinkTier, FolderLinkAction | null>;
export type TierMode = "4-tier" | "2-tier";
export interface ModifierEvent {
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
}
export type UrlLinkAction = (
	event: ModifierEvent,
	url: string,
) => LinkAction | null;
export interface LinkSettings {
	urlLinks: LinkTierMap;
	fileLinks: LinkTierMap;
	sidebarFileLinks: LinkTierMap;
	folderLinks: FolderTierMap;
}
