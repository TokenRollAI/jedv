import { i18n } from "@jedv/i18n";
import {
	findPanePath,
	type LayoutNode,
	type Pane,
	type SplitPosition,
	transferPaneToSplit,
} from "@jedv/panes";
import type {
	PaneLayoutErrorCode,
	PaneLayoutNode,
	PaneLayoutOp,
	PaneLayoutOpResult,
	PaneLayoutSnapshot,
} from "@jedv/shared/pane-layout-ops";
import { msg } from "@lingui/core/macro";
import {
	detachTerminalPane,
	findTerminalPane,
	focusWorkspacePane,
	moveWorkspacePane,
	openChangesTab,
	openFilesTab,
	paneTerminalId,
	type TerminalLayoutStore,
	type WorkspacePaneData,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";

export class PaneOperationError extends Error {
	constructor(
		readonly code: PaneLayoutErrorCode,
		message: string,
	) {
		super(message);
	}
}
function missing(): never {
	throw new PaneOperationError(
		"NOT_FOUND",
		i18n._(msg({ message: "The pane or tab is not in this workspace." })),
	);
}
function unsupported(): never {
	throw new PaneOperationError(
		"PRECONDITION_FAILED",
		i18n._(
			msg({ message: "This pane operation is not supported by this desktop." }),
		),
	);
}
function capacity(): never {
	throw new PaneOperationError(
		"PRECONDITION_FAILED",
		i18n._(
			msg({
				message:
					"A workspace can contain at most 32 tabs and each tab at most eight panes.",
			}),
		),
	);
}
export function validatePaneOperation(
	op: PaneLayoutOp | { type: "wakeBrowser"; paneId: string },
) {
	if (
		op.type === "wakeBrowser" ||
		(op.type === "newTab" && (op.chat || !op.terminalId))
	)
		unsupported();
	if (
		op.type === "open" &&
		((op.tool !== "changes" && op.tool !== "files") ||
			op.path ||
			op.line ||
			op.url ||
			op.slug)
	)
		unsupported();
	if (op.type === "sidebar" && op.fullScreen !== undefined) unsupported();
}
function layoutNode(node: LayoutNode): PaneLayoutNode {
	return node.type === "pane"
		? { ...node }
		: {
				type: "split",
				direction: node.direction === "horizontal" ? "row" : "column",
				ratio: (node.splitPercentage ?? 50) / 100,
				first: layoutNode(node.first),
				second: layoutNode(node.second),
			};
}
export function paneLayoutSnapshot(
	store: TerminalLayoutStore,
	sidebarFullScreen = false,
): PaneLayoutSnapshot {
	const areas = workspacePaneAreas(store);
	const flags = areas.state.getState();
	const tabs = (area: TerminalLayoutStore) =>
		area.getState().tabs.map((tab) => ({
			id: tab.id,
			title: tab.titleOverride ?? null,
			active: area.getState().activeTabId === tab.id,
			activePaneId: tab.activePaneId,
			layout: layoutNode(tab.layout),
			panes: Object.values(tab.panes).map((pane) => ({
				id: pane.id,
				kind: pane.kind,
				title: pane.titleOverride ?? null,
				terminalId: paneTerminalId(pane),
				active: tab.activePaneId === pane.id,
			})),
		}));
	return {
		activeTabId: areas.left.getState().activeTabId,
		tabs: tabs(areas.left),
		sidebar: {
			open: flags.rightAreaOpen,
			fullScreen: flags.rightAreaOpen && sidebarFullScreen,
			activeTabId: areas.right.getState().activeTabId,
			tabs: tabs(areas.right),
		},
	};
}
const position = (
	direction: "left" | "right" | "up" | "down",
): SplitPosition =>
	direction === "up" ? "top" : direction === "down" ? "bottom" : direction;

export function applyPaneLayoutOperation(input: {
	store: TerminalLayoutStore;
	sessions: readonly TerminalSession[];
	sidebarFullScreen?: boolean;
	op: PaneLayoutOp | { type: "wakeBrowser"; paneId: string };
}): PaneLayoutOpResult {
	const { store, op, sessions } = input;
	validatePaneOperation(op);
	const areas = workspacePaneAreas(store);
	const stores = [areas.left, areas.right];
	const find = (id: string) => {
		for (const area of stores) {
			const found = area.getState().getPane(id);
			if (found) return { ...found, store: area };
		}
		return missing();
	};
	const availableId = (preferred: string) =>
		stores.some(
			(area) =>
				area.getState().getPane(preferred) || area.getState().getTab(preferred),
		)
			? `pane-${crypto.randomUUID()}`
			: preferred;
	const tabCount = () =>
		stores.reduce((n, area) => n + area.getState().tabs.length, 0);
	const newTabCapacity = (extra = 1) => {
		if (tabCount() + extra > 32) capacity();
	};
	const ensureTerminal = (id: string) => {
		if (!sessions.some((session) => session.terminalId === id))
			throw new PaneOperationError(
				"NOT_FOUND",
				i18n._(
					msg({ message: "The terminal is not available in this workspace." }),
				),
			);
	};
	const assertPaneCount = (
		area: TerminalLayoutStore,
		tabId: string,
		extra: number,
	) => {
		if (
			Object.keys(area.getState().getTab(tabId)?.panes ?? {}).length + extra >
			8
		)
			capacity();
	};
	let paneId: string | null = null;
	let tabId: string | null = null;
	const resultAt = (id: string) => {
		const found = find(id);
		paneId = id;
		tabId = found.tabId;
	};
	const move = (
		id: string,
		targetId: string,
		direction: "left" | "right" | "up" | "down",
	) => {
		const source = find(id),
			target = find(targetId);
		if (id === targetId)
			throw new PaneOperationError(
				"BAD_REQUEST",
				i18n._(msg({ message: "Choose two different panes." })),
			);
		assertPaneCount(
			target.store,
			target.tabId,
			source.store === target.store && source.tabId === target.tabId ? 0 : 1,
		);
		if (source.store === target.store)
			source.store.getState().movePaneToSplit({
				sourcePaneId: id,
				targetPaneId: targetId,
				position: position(direction),
			});
		else
			transferPaneToSplit({
				source: source.store,
				target: target.store,
				paneId: id,
				targetPaneId: targetId,
				position: position(direction),
			});
		focusWorkspacePane(target.store, id);
		resultAt(id);
	};
	switch (op.type) {
		case "list":
			break;
		case "split": {
			const anchor = find(op.paneId);
			ensureTerminal(op.terminalId);
			const existing = findTerminalPane(store, op.terminalId);
			if (existing) {
				move(existing.pane.id, op.paneId, op.direction);
				break;
			}
			assertPaneCount(anchor.store, anchor.tabId, 1);
			const id = availableId(op.terminalId);
			anchor.store.getState().splitPane({
				tabId: anchor.tabId,
				paneId: op.paneId,
				position: position(op.direction),
				newPane: {
					id,
					kind: "terminal",
					data: { terminalId: op.terminalId },
					pinned: true,
				},
			});
			focusWorkspacePane(anchor.store, id);
			resultAt(id);
			break;
		}
		case "newTab": {
			if (!op.terminalId || op.chat) return unsupported();
			ensureTerminal(op.terminalId);
			const target = op.area === "sidebar" ? areas.right : areas.left;
			const existing = findTerminalPane(store, op.terminalId);
			if (existing) {
				if (op.area && target !== existing.store) {
					const prior = areas.state.getState();
					const priorSource = existing.store.getState(),
						priorTarget = target.getState();
					moveWorkspacePane(existing.store, target, existing.pane.id);
					if (op.focus === false) {
						areas.state.setState(prior, true);
						existing.store.setState({ focusRequest: priorSource.focusRequest });
						target.setState({
							activeTabId: priorTarget.activeTabId,
							focusRequest: priorTarget.focusRequest,
						});
					}
				}
				if (op.focus !== false)
					focusWorkspacePane(find(existing.pane.id).store, existing.pane.id);
				resultAt(existing.pane.id);
				break;
			}
			newTabCapacity();
			const previous = target.getState(),
				id = availableId(op.terminalId);
			target.getState().addTab({
				id,
				panes: [
					{
						id,
						kind: "terminal",
						data: { terminalId: op.terminalId },
						pinned: true,
					},
				],
				focus: op.focus !== false,
				reuse: false,
			});
			if (op.focus !== false) focusWorkspacePane(target, id);
			else if (previous.activeTabId)
				target.setState({
					activeTabId: previous.activeTabId,
					focusRequest: previous.focusRequest,
				});
			resultAt(id);
			break;
		}
		case "resize": {
			const found = find(op.paneId),
				tab = found.store.getState().getTab(found.tabId);
			if (!tab) return missing();
			const path = findPanePath(tab.layout, op.paneId);
			if (!path?.length)
				throw new PaneOperationError(
					"PRECONDITION_FAILED",
					i18n._(msg({ message: "This pane has no split to resize." })),
				);
			found.store.getState().resizeSplit({
				tabId: tab.id,
				path: path.slice(0, -1),
				splitPercentage:
					(path.at(-1) === "first" ? op.ratio : 1 - op.ratio) * 100,
			});
			resultAt(op.paneId);
			break;
		}
		case "equalize": {
			if (op.tabId) {
				const selectedTabId = op.tabId;
				const area = stores.find((area) =>
					area.getState().getTab(selectedTabId),
				);
				if (!area) return missing();
				area.getState().equalizeTab({ tabId: op.tabId });
				tabId = op.tabId;
			} else
				for (const area of stores)
					for (const tab of area.getState().tabs)
						area.getState().equalizeTab({ tabId: tab.id });
			break;
		}
		case "focus": {
			const found = find(op.paneId);
			focusWorkspacePane(found.store, op.paneId);
			resultAt(op.paneId);
			break;
		}
		case "close": {
			const found = find(op.paneId);
			if (found.pane.kind === "files")
				throw new PaneOperationError(
					"PRECONDITION_FAILED",
					i18n._(
						msg({
							message:
								"Close the files view in the desktop so unsaved changes can be checked.",
						}),
					),
				);
			if (op.keepTerminal) detachTerminalPane(found.store, op.paneId);
			else
				found.store.getState().closePane({
					tabId: found.tabId,
					paneId: op.paneId,
					intent: "close",
				});
			break;
		}
		case "move":
			move(op.paneId, op.targetPaneId, op.direction);
			break;
		case "moveToNewTab": {
			const found = find(op.paneId);
			const target = op.area
				? op.area === "sidebar"
					? areas.right
					: areas.left
				: found.store;
			newTabCapacity(
				Object.keys(found.store.getState().getTab(found.tabId)?.panes ?? {})
					.length > 1
					? 1
					: 0,
			);
			if (target !== found.store)
				moveWorkspacePane(found.store, target, op.paneId);
			else found.store.getState().movePaneToNewTab({ paneId: op.paneId });
			focusWorkspacePane(target, op.paneId);
			resultAt(op.paneId);
			break;
		}
		case "swap": {
			const first = find(op.paneId),
				second = find(op.withPaneId);
			if (op.paneId === op.withPaneId) {
				resultAt(op.paneId);
				break;
			}
			const swapId = (id: string | null) =>
				id === op.paneId
					? op.withPaneId
					: id === op.withPaneId
						? op.paneId
						: id;
			const swapNode = (node: LayoutNode): LayoutNode =>
				node.type === "pane"
					? { ...node, paneId: swapId(node.paneId) ?? node.paneId }
					: {
							...node,
							first: swapNode(node.first),
							second: swapNode(node.second),
						};
			for (const area of new Set([first.store, second.store]))
				area.getState().replaceState((state) => ({
					...state,
					tabs: state.tabs.map((tab) => {
						if (!tab.panes[op.paneId] && !tab.panes[op.withPaneId]) return tab;
						const panes: Record<string, Pane<WorkspacePaneData>> = {};
						for (const [id, pane] of Object.entries(tab.panes)) {
							const replacement =
								id === op.paneId
									? second.pane
									: id === op.withPaneId
										? first.pane
										: pane;
							panes[replacement.id] = replacement;
						}
						return {
							...tab,
							panes,
							layout: swapNode(tab.layout),
							activePaneId: swapId(tab.activePaneId),
						};
					}),
				}));
			for (const area of new Set([first.store, second.store]))
				area.setState({ focusRequest: null });
			resultAt(op.paneId);
			break;
		}
		case "open": {
			const target = areas.right,
				before = stores.map((area) => area.getState()),
				flags = areas.state.getState();
			const existing = stores.flatMap((area) =>
				area.getState().tabs.flatMap((tab) =>
					Object.values(tab.panes)
						.filter((pane) => pane.kind === op.tool)
						.map((pane) => ({ store: area, pane })),
				),
			)[0];
			const id =
				existing?.pane.id ??
				(op.tool === "changes" ? openChangesTab(target) : openFilesTab(target));
			if (existing && existing.store !== target)
				moveWorkspacePane(existing.store, target, id);
			if (op.background) {
				for (let index = 0; index < stores.length; index++) {
					const area = stores[index],
						previous = before[index],
						current = area.getState();
					area.setState({
						activeTabId:
							previous.activeTabId && current.getTab(previous.activeTabId)
								? previous.activeTabId
								: current.activeTabId,
						focusRequest:
							previous.focusRequest &&
							current.getPane(previous.focusRequest.paneId)
								? previous.focusRequest
								: null,
						tabs: current.tabs.map((tab) => {
							const activePaneId = previous.tabs.find(
								(old) => old.id === tab.id,
							)?.activePaneId;
							return activePaneId && tab.panes[activePaneId]
								? { ...tab, activePaneId }
								: tab;
						}),
					});
				}
				areas.state.setState(flags, true);
			} else focusWorkspacePane(target, id);
			resultAt(id);
			break;
		}
		case "sidebar":
			areas.state.setState({
				rightAreaOpen: op.open,
				...(!op.open ? { focusedArea: "left" as const } : {}),
			});
			break;
		case "wakeBrowser":
			return unsupported();
	}
	return {
		paneId,
		tabId,
		layout: paneLayoutSnapshot(store, input.sidebarFullScreen),
	};
}
