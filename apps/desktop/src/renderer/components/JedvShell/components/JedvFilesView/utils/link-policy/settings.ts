import type { LinkSettings } from "./types";

export const DEFAULT_LINK_SETTINGS: LinkSettings = {
	urlLinks: {
		plain: "external",
		shift: "external",
		meta: "external",
		metaShift: "external",
	},
	fileLinks: { plain: null, shift: null, meta: "pane", metaShift: "external" },
	sidebarFileLinks: {
		plain: "pane",
		shift: "newTab",
		meta: "pane",
		metaShift: "external",
	},
	folderLinks: {
		plain: null,
		shift: "finder",
		meta: "reveal",
		metaShift: "external",
	},
};

export function healLinkSettings(raw: unknown): LinkSettings {
	const source =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const heal = <K extends keyof LinkSettings>(key: K): LinkSettings[K] => {
		const fallback = DEFAULT_LINK_SETTINGS[key];
		const map =
			source[key] && typeof source[key] === "object"
				? (source[key] as Record<string, unknown>)
				: {};
		const allowed =
			key === "folderLinks"
				? ["reveal", "external", "finder"]
				: key === "urlLinks"
					? ["external"]
					: ["pane", "newTab", "external"];
		return Object.fromEntries(
			Object.entries(fallback).map(([tier, value]) => [
				tier,
				map[tier] === null ||
				(typeof map[tier] === "string" && allowed.includes(map[tier]))
					? map[tier]
					: value,
			]),
		) as LinkSettings[K];
	};
	return {
		urlLinks: heal("urlLinks"),
		fileLinks: heal("fileLinks"),
		sidebarFileLinks: heal("sidebarFileLinks"),
		folderLinks: heal("folderLinks"),
	};
}
