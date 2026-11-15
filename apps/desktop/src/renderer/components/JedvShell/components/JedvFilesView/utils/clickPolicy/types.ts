export type LinkAction = "pane" | "newTab" | "external" | "rightPane";
export type LinkTier = "plain" | "shift" | "meta" | "metaShift";
export type LinkTierMap = Record<LinkTier, LinkAction | null>;
export interface ModifierEvent {
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
}
export type TierMode = "4-tier" | "2-tier";
export type Surface = "file" | "url";
export interface ResolvedClick {
	tier: LinkTier;
	action: LinkAction | null;
}
