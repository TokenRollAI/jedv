import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import {
	decodeWorkspaceLayout,
	type JedvWorkspaceLayout,
} from "shared/jedv-workspace-layout";
import {
	createTerminalWorkspaceStore,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { captureTerminalPanes, rebindVerifiedTerminal } from "./rebind";

export function missingSavedTerminals(
	layout: JedvWorkspaceLayout,
	sessions: readonly TerminalSession[],
) {
	const live = new Set(sessions.map((session) => session.terminalId));
	return [
		...new Set(
			[...layout.tabs, ...(layout.rightArea?.tabs ?? [])].flatMap((tab) =>
				Object.values(tab.panes).flatMap((pane) =>
					pane.kind === "terminal" &&
					"terminalId" in pane.data &&
					!live.has(pane.data.terminalId)
						? [pane.data.terminalId]
						: [],
				),
			),
		),
	];
}
export async function resolveSavedTerminalSuccessors(input: {
	layout: JedvWorkspaceLayout;
	missing: readonly string[];
	resolveResumedTerminal(terminalId: string): Promise<string | null>;
	getSessions(): readonly TerminalSession[];
}): Promise<JedvWorkspaceLayout> {
	const mappings = new Map<string, string>();
	let index = 0;
	let failed = false;
	let failure: unknown;
	const worker = async () => {
		while (!failed && index < input.missing.length) {
			const previous = input.missing[index++];
			let successor: string | null;
			try {
				successor = await input.resolveResumedTerminal(previous);
			} catch (error) {
				failed = true;
				failure = error;
				return;
			}
			if (successor && successor !== previous)
				mappings.set(previous, successor);
		}
	};
	await Promise.all(Array.from({ length: 2 }, worker));
	if (failed) throw failure;
	const live = new Set(
		input.getSessions().map((session) => session.terminalId),
	);
	for (const [previous, successor] of mappings) {
		if (live.has(previous)) continue;
		if (!live.has(successor))
			throw new Error(
				i18n._(
					msg({
						message:
							"The resumed terminal is not available yet. Refresh the workspace to retry.",
					}),
				),
			);
	}
	const store = createTerminalWorkspaceStore(),
		areas = workspacePaneAreas(store);
	store.setState({
		tabs: input.layout.tabs,
		activeTabId: input.layout.activeTabId,
	});
	if (input.layout.rightArea)
		areas.right.setState({
			tabs: input.layout.rightArea.tabs,
			activeTabId: input.layout.rightArea.activeTabId,
		});
	areas.state.setState({ rightAreaOpen: input.layout.rightAreaOpen ?? false });
	for (const [previousTerminalId, terminalId] of mappings) {
		if (live.has(previousTerminalId)) continue;
		rebindVerifiedTerminal({
			store,
			previousTerminalId,
			terminalId,
			captured: captureTerminalPanes(store).filter(
				(location) => location.pane.data.terminalId === previousTerminalId,
			),
		});
	}
	const attached = new Set(
		captureTerminalPanes(store).map(
			(location) => location.pane.data.terminalId,
		),
	);
	return decodeWorkspaceLayout({
		...input.layout,
		tabs: store.getState().tabs,
		activeTabId: store.getState().activeTabId,
		detachedTerminalIds: input.layout.detachedTerminalIds.filter(
			(id) => !attached.has(id),
		),
		...(input.layout.rightArea
			? {
					rightArea: {
						version: 1,
						tabs: areas.right.getState().tabs,
						activeTabId: areas.right.getState().activeTabId,
					},
				}
			: {}),
	});
}
