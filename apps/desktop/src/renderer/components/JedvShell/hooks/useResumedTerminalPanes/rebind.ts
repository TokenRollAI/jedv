import type { Pane } from "@jedv/panes";
import {
	isTerminalPane,
	type TerminalLayoutStore,
	type TerminalPaneData,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";

export const MAX_RESUME_PANES = 256;
export interface CapturedTerminalPane {
	store: TerminalLayoutStore;
	tabId: string;
	pane: Pane<TerminalPaneData>;
}
export function captureTerminalPanes(
	store: TerminalLayoutStore,
): CapturedTerminalPane[] {
	const areas = workspacePaneAreas(store);
	const result: CapturedTerminalPane[] = [];
	for (const area of [areas.left, areas.right]) {
		for (const tab of area.getState().tabs) {
			for (const pane of Object.values(tab.panes)) {
				if (isTerminalPane(pane))
					result.push({ store: area, tabId: tab.id, pane });
				if (result.length >= MAX_RESUME_PANES) return result;
			}
		}
	}
	return result;
}
export interface ReboundTerminalPane {
	previousTerminalId: string;
	terminalId: string;
	paneId: string;
	removedPaneIds: string[];
}
export function rebindVerifiedTerminal(input: {
	store: TerminalLayoutStore;
	previousTerminalId: string;
	terminalId: string;
	captured: readonly CapturedTerminalPane[];
}): ReboundTerminalPane | null {
	const { store, previousTerminalId, terminalId } = input;
	if (!terminalId || terminalId === previousTerminalId) return null;
	const areas = workspacePaneAreas(store);
	const stores = [areas.left, areas.right];
	const previous = input.captured.filter((candidate) => {
		if (
			!stores.includes(candidate.store) ||
			candidate.pane.data.terminalId !== previousTerminalId
		)
			return false;
		const current = candidate.store.getState().getPane(candidate.pane.id);
		return (
			current?.tabId === candidate.tabId && current.pane === candidate.pane
		);
	});
	if (!previous.length) return null;
	const successors = captureTerminalPanes(store).filter(
		(candidate) => candidate.pane.data.terminalId === terminalId,
	);
	const flags = areas.state.getState();
	const focusedStore =
		flags.rightAreaOpen && flags.focusedArea === "right"
			? areas.right
			: areas.left;
	const focusedPane = focusedStore.getState().getActivePane()?.pane;
	// A user may have explicitly opened/focused the successor while the query
	// was pending. Keep that focus; otherwise the old pane retains its position.
	const retained =
		successors.find(
			(candidate) =>
				candidate.store === focusedStore && candidate.pane === focusedPane,
		) ??
		previous.find(
			(candidate) =>
				candidate.store === focusedStore && candidate.pane === focusedPane,
		) ??
		previous[0];
	const removedPaneIds: string[] = [];
	for (const redundant of [...previous, ...successors]) {
		if (redundant === retained) continue;
		redundant.store.getState().closePane({
			tabId: redundant.tabId,
			paneId: redundant.pane.id,
			intent: "remove",
		});
		removedPaneIds.push(redundant.pane.id);
	}
	if (retained.pane.data.terminalId === previousTerminalId)
		retained.store.getState().setPaneData({
			paneId: retained.pane.id,
			data: { ...retained.pane.data, terminalId },
		});
	return {
		previousTerminalId,
		terminalId,
		paneId: retained.pane.id,
		removedPaneIds,
	};
}
