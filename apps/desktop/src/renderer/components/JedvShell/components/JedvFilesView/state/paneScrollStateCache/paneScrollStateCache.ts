const MAX_ENTRIES = 250;
export interface PaneScrollPosition {
	scrollTop: number;
	scrollLeft: number;
}
export interface PaneScrollState extends PaneScrollPosition {
	updatedAt: number;
}
const cache = new Map<string, PaneScrollState>();
function getCache(): Map<string, PaneScrollState> {
	return cache;
}
export function createPaneScrollStateKey({
	workspaceId,
	paneId,
	viewId,
	resourceId,
}: {
	workspaceId: string;
	paneId?: string;
	viewId: "diff" | "editor";
	resourceId: string;
}): string {
	return JSON.stringify([workspaceId, paneId ?? null, viewId, resourceId]);
}

export function getPaneScrollState(key: string): PaneScrollState | undefined {
	const state = getCache().get(key);
	if (
		!state ||
		!Number.isFinite(state.scrollTop) ||
		!Number.isFinite(state.scrollLeft) ||
		!Number.isFinite(state.updatedAt)
	) {
		return undefined;
	}
	return { ...state };
}

export function savePaneScrollState(
	key: string,
	position: PaneScrollPosition,
): void {
	if (
		!Number.isFinite(position.scrollTop) ||
		!Number.isFinite(position.scrollLeft)
	) {
		return;
	}
	const entries = getCache();
	entries.delete(key);
	entries.set(key, {
		scrollTop: Math.max(0, position.scrollTop),
		scrollLeft: Math.max(0, position.scrollLeft),
		updatedAt: Date.now(),
	});
	if (entries.size > MAX_ENTRIES) {
		const oldestKey = entries.keys().next().value;
		if (oldestKey !== undefined) entries.delete(oldestKey);
	}
}
