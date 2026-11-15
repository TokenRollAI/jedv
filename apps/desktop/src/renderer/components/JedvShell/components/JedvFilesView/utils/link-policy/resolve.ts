import { tierFor } from "../clickPolicy/tiers";
import type {
	FolderTierMap,
	LinkAction,
	LinkTierMap,
	ModifierEvent,
	TierMode,
} from "./types";

export { tierFor } from "../clickPolicy/tiers";

export function resolveUrlLinkAction(
	map: LinkTierMap,
	event: ModifierEvent,
	mode: TierMode,
): LinkAction | null {
	const action = map[tierFor(event, mode)];
	return action === null ? null : "external";
}

export function resolveFileLinkAction(
	map: LinkTierMap,
	event: ModifierEvent,
	mode: TierMode,
	remote: boolean,
): LinkAction | null {
	const action = map[tierFor(event, mode)];
	return remote && action === "external"
		? null
		: action === "rightPane"
			? "pane"
			: action;
}

export function resolveFolderLinkAction(
	map: FolderTierMap,
	event: ModifierEvent,
	remote: boolean,
) {
	const action = map[tierFor(event, "4-tier")];
	return remote && action !== "reveal" ? null : action;
}
