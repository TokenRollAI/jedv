import { useMemo } from "react";
import { useSettings } from "renderer/stores/settings";
import { buildHint } from "../hint";
import { tierFor } from "../tiers";
import type {
	LinkAction,
	LinkTierMap,
	ModifierEvent,
	ResolvedClick,
	Surface,
	TierMode,
} from "../types";
export interface ClickPolicy {
	resolve: (event: ModifierEvent) => ResolvedClick;
	getAction: (event: ModifierEvent) => LinkAction | null;
	tierForAction: (action: LinkAction) => keyof LinkTierMap | null;
	hint: string;
	map: LinkTierMap;
}

const TIER_ORDER: (keyof LinkTierMap)[] = [
	"plain",
	"shift",
	"meta",
	"metaShift",
];

function tierForActionIn(
	map: LinkTierMap,
	action: LinkAction,
): keyof LinkTierMap | null {
	for (const tier of TIER_ORDER) {
		if (map[tier] === action) return tier;
	}
	return null;
}

export function buildPolicy(
	map: LinkTierMap,
	surface: Surface,
	mode: TierMode,
): ClickPolicy {
	const resolve = (event: ModifierEvent): ResolvedClick => {
		const tier = tierFor(event, mode);
		return { tier, action: map[tier] };
	};
	return {
		resolve,
		getAction: (event) => resolve(event).action,
		tierForAction: (action) => tierForActionIn(map, action),
		get hint() {
			return buildHint(map, surface, mode);
		},
		map,
	};
}

export const sidebarFilePolicy = buildPolicy(
	{ plain: "pane", shift: "newTab", meta: "pane", metaShift: "external" },
	"file",
	"4-tier",
);

export function useSidebarFilePolicy(remote: boolean): ClickPolicy {
	const map = useSettings((state) => state.sidebarFileLinks);
	return useMemo(
		() =>
			buildPolicy(
				remote
					? (Object.fromEntries(
							Object.entries(map).map(([tier, action]) => [
								tier,
								action === "external" ? null : action,
							]),
						) as LinkTierMap)
					: map,
				"file",
				"4-tier",
			),
		[map, remote],
	);
}
