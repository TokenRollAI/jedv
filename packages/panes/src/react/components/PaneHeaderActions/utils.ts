import type { ReactNode } from "react";
import type { PaneActionConfig, RendererContext } from "../../types";

export function resolvePaneActionLabel<TData>(
	action: PaneActionConfig<TData>,
	context: RendererContext<TData>,
	tooltip: ReactNode,
	fallbacks: {
		splitRight: string;
		splitDown: string;
		close: string;
	},
): string {
	const explicit =
		typeof action.label === "function" ? action.label(context) : action.label;
	if (explicit && explicit.trim().length > 0) return explicit;
	if (typeof tooltip === "string" && tooltip.trim().length > 0) return tooltip;
	if (action.key === "split-right") return fallbacks.splitRight;
	if (action.key === "split-down") return fallbacks.splitDown;
	if (action.key === "close") return fallbacks.close;
	return action.key;
}
