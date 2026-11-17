import type { PaneDefinition, RendererContext } from "../../../../../../types";

export function shouldShowPaneHeader<TData>({
	paneCount,
	parentDirection,
	hasCustomToolbar,
	definition,
	context,
}: {
	paneCount: number;
	parentDirection: "horizontal" | "vertical" | null;
	hasCustomToolbar: boolean;
	definition?: PaneDefinition<TData>;
	context: RendererContext<TData>;
}): boolean {
	if (definition?.hideHeader?.(context)) return false;
	const isSingleUnsplitPane = paneCount <= 1 && parentDirection === null;
	if (isSingleUnsplitPane && !hasCustomToolbar) return false;
	return true;
}
