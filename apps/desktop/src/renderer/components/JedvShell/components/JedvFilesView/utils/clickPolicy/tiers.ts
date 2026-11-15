import type { LinkTier, ModifierEvent, TierMode } from "./types";

export function tierFor(event: ModifierEvent, mode: TierMode): LinkTier {
	const meta = event.metaKey || event.ctrlKey;
	if (mode === "2-tier") return meta ? "meta" : "plain";
	if (meta) return event.shiftKey ? "metaShift" : "meta";
	return event.shiftKey ? "shift" : "plain";
}
