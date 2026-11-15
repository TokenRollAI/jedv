import {
	type ContextMenuActionConfig,
	type FocusDirection,
	getPaneParentDirection,
	getSpatialNeighborPaneId,
	type PaneRegistry,
	type RendererContext,
	Workspace,
} from "@jedv/panes";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@jedv/ui/dropdown-menu";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createPortal } from "react-dom";
import {
	LuArrowDownToLine,
	LuArrowLeftToLine,
	LuArrowRightToLine,
	LuClipboard,
	LuClipboardCopy,
	LuColumns2,
	LuCopy,
	LuEqual,
	LuEraser,
	LuExternalLink,
	LuFolderOpen,
	LuGitCompareArrows,
	LuLink,
	LuMoveRight,
	LuPlus,
	LuPower,
	LuRows2,
	LuSearch,
	LuTerminal,
	LuX,
} from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { writeTerminalClipboard } from "renderer/lib/terminal/terminal-clipboard";
import { terminalRuntimeRegistry as registry } from "renderer/lib/terminal/terminal-runtime-registry";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { LocalClient, LocalConnection } from "../../local-client";
import type { HostAgentConfig, TerminalSession } from "../../types";

import { JedvChangesView } from "../JedvChangesView";
import type { TerminalSessionsMenuProps } from "../JedvTerminalTabStrip/types";
import { terminalContextMenuLinkStore } from "../LocalTerminal/links";
import { FilesPaneSlot } from "./components/FilesPaneSlot";

import { JedvTerminalPane } from "./components/JedvTerminalPane";
import { TerminalPaneSessionMenu } from "./components/TerminalPaneSessionMenu";
import {
	type TerminalActivityEvent,
	TerminalTabActivity,
} from "./components/TerminalTabActivity";
import {
	detachTerminalPane,
	detachTerminalTab,
	isTerminalPane,
	moveWorkspacePane,
	openChangesTab,
	paneTerminalId,
	reopenTerminalTab,
	type TerminalLayoutStore,
	type WorkspacePaneData,
} from "./layout";
export interface TerminalWorkspaceActions {
	focusKind(): "terminal" | null;

	split(position: "right" | "bottom" | "auto"): Promise<void>;
	find(): void;
	clear(): void;
	scrollToBottom(): void;
	closeView(): void;
	reopen(): void;
	equalize(): void;
	cycleTab(direction: number): void;
	selectTab(index: number): void;
	focus(direction: FocusDirection): void;
}
export function JedvTerminalWorkspace(props: {
	client: LocalClient;
	connection: LocalConnection;
	workspaceId: string;
	hostUrl: string;
	onOpenUrl?(
		url: string,
		placement?: "pane" | "newTab" | "external" | "rightPane",
	): void | Promise<void>;

	store: TerminalLayoutStore;
	sessions?: TerminalSession[];
	onCreated(): Promise<void>;
	activeId: string | null;
	remote: boolean;
	active: boolean;
	onSelect(id: string | null): void;
	onKill(id: string, isCurrent?: () => boolean): void;
	onOpenFile(path: string, pinned?: boolean): void;
	getHasUnsavedFiles?(): boolean;
	onConnectionChange(connected: boolean): void;
	actionsRef: { current: TerminalWorkspaceActions | null };
	tabBarMount: HTMLDivElement | null;
	emptyState: ReactNode;
	onNew(): void;
	filesHost?: HTMLElement | null;
	otherArea?: TerminalLayoutStore;
	area?: "left" | "right";
	toolbar?: ReactNode;
	onAreaFocus?(): void;
	sessionsMenu?: ReactNode;
	sessionMenuProps?: TerminalSessionsMenuProps;
	focused?: boolean;
	contentInsetRight?: number;
	agentConfigs: HostAgentConfig[];
	onLaunch(config: HostAgentConfig): void;
	agentSessionByTerminal: Map<string, string>;
	agentByTerminal: Map<string, string>;
	agentProjectionReady?: boolean;
	agentBindings?: readonly TerminalActivityEvent[];
}) {
	const { t } = useLingui();
	const showScripts = electronTrpc.settings.getShowPresetsBar.useQuery();
	const settingsUtils = electronTrpc.useUtils();
	const latest = useRef(props);
	latest.current = props;
	const store = props.store;
	const [searchPane, setSearchPane] = useState<string | null>(null);
	const pending = useRef(false);
	const mounted = useRef(true);
	const right = useHotkeyDisplay("SPLIT_RIGHT").text;
	const down = useHotkeyDisplay("SPLIT_DOWN").text;
	const equal = useHotkeyDisplay("EQUALIZE_PANE_SPLITS").text;
	const clear = useHotkeyDisplay("CLEAR_TERMINAL").text;
	const scroll = useHotkeyDisplay("SCROLL_TO_BOTTOM").text;
	const find = useHotkeyDisplay("FIND_IN_TERMINAL").text;
	const close = useHotkeyDisplay("CLOSE_PANE").text;
	const newTerminalShortcut = useHotkeyDisplay("NEW_GROUP").text;

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		const found = props.activeId
			? store.getState().findPaneByKey(props.activeId)
			: null;
		if (found && store.getState().getActivePane()?.pane.id !== found.pane.id)
			store.getState().focusPane(found.pane.id);
	}, [store, props.activeId]);
	useEffect(() => {
		const publish = () => {
			if (props.focused === false) return;
			const id = paneTerminalId(store.getState().getActivePane()?.pane);
			if (id !== latest.current.activeId) latest.current.onSelect(id);
		};
		publish();
		return store.subscribe(publish);
	}, [store, props.focused]);
	const split = async (
		position: "right" | "bottom" | "auto",
		anchor?: RendererContext<WorkspacePaneData>,
	) => {
		if (pending.current) return;
		const found = anchor
			? { tabId: anchor.tab.id, pane: anchor.pane }
			: store.getState().getActivePane();
		if (!found) return;
		const tab = store.getState().getTab(found.tabId);
		if (!tab) return;
		if (Object.keys(tab.panes).length >= 8)
			throw new Error(t({ message: "A tab can contain at most eight panes." }));
		const target =
			position === "auto"
				? getPaneParentDirection(tab.layout, found.pane.id) === "horizontal"
					? "bottom"
					: "right"
				: position;
		pending.current = true;
		try {
			const current = latest.current;
			const session = await current.client.terminal.createSession.mutate({
				workspaceId: current.workspaceId,
			});
			await current.onCreated();
			if (!mounted.current) return;
			const stillThere = store.getState().getPane(found.pane.id);
			if (!stillThere) return;
			store.getState().splitPane({
				tabId: stillThere.tabId,
				paneId: found.pane.id,
				position: target,
				newPane: {
					id: session.terminalId,
					kind: "terminal",
					data: { terminalId: session.terminalId },
					pinned: true,
				},
			});
			current.onSelect(session.terminalId);
		} finally {
			pending.current = false;
		}
	};

	const splitRef = useRef(split);
	splitRef.current = split;
	useEffect(() => {
		const active = () => store.getState().getActivePane();
		const terminal = () => {
			const pane = active()?.pane;
			return isTerminalPane(pane)
				? registry.getTerminal(pane.data.terminalId, pane.id)
				: null;
		};
		props.actionsRef.current = {
			focusKind: () => {
				if (!latest.current.active) return null;
				const pane = active()?.pane;
				return isTerminalPane(pane) ? "terminal" : null;
			},

			split: (position) => splitRef.current(position),
			find: () => {
				const pane = active()?.pane;
				if (isTerminalPane(pane)) setSearchPane(pane.id);
			},
			clear: () => terminal()?.clear(),
			scrollToBottom: () => terminal()?.scrollToBottom(),
			closeView: () => {
				const pane = active()?.pane;
				if (pane) report(() => detachTerminalPane(store, pane.id));
			},
			reopen: () => {
				reopenTerminalTab(store, latest.current.sessions ?? []);
			},
			equalize: () => {
				const tab = store.getState().getActiveTab();
				if (tab) store.getState().equalizeTab({ tabId: tab.id });
			},
			selectTab: (index) => {
				const tab = store.getState().tabs[index];
				if (tab) {
					store.getState().setActiveTab(tab.id);
					const pane = store.getState().getActivePane();
					if (pane) store.getState().focusPane(pane.pane.id);
				}
			},
			cycleTab: (direction) => {
				const state = store.getState();
				if (!state.tabs.length) return;
				const index = state.tabs.findIndex(
					(tab) => tab.id === state.activeTabId,
				);
				state.setActiveTab(
					state.tabs[
						(index + direction + state.tabs.length) % state.tabs.length
					].id,
				);
				const pane = state.getActivePane();
				if (pane) state.focusPane(pane.pane.id);
			},
			focus: (direction) => {
				const tab = store.getState().getActiveTab();
				if (!tab?.activePaneId) return;
				const id = getSpatialNeighborPaneId(
					tab.layout,
					tab.activePaneId,
					direction,
				);
				if (id) store.getState().focusPane(id);
			},
		};
		return () => {
			props.actionsRef.current = null;
		};
	}, [store, props.actionsRef]);
	const registryDefinition = useMemo<PaneRegistry<WorkspacePaneData>>(
		() => ({
			terminal: {
				keepAlive: true,
				getTitle: (pane) =>
					pane.titleOverride ??
					latest.current.sessions?.find(
						(session) => session.terminalId === paneTerminalId(pane),
					)?.title ??
					t({ message: "Terminal" }),
				renderTitle: (context) =>
					latest.current.sessionMenuProps ? (
						<TerminalPaneSessionMenu
							context={context}
							menuProps={latest.current.sessionMenuProps}
							displayAgentId={
								props.agentProjectionReady
									? (props.agentByTerminal.get(
											paneTerminalId(context.pane) ?? "",
										) ?? null)
									: undefined
							}
							onCreated={latest.current.onCreated}
						/>
					) : undefined,
				getIcon: (context) => {
					const id = paneTerminalId(context.pane);
					const agent = id ? latest.current.agentByTerminal.get(id) : undefined;
					return agent ? (
						<AgentIcon presetId={agent} className="size-3.5" />
					) : (
						<LuTerminal className="size-3.5" />
					);
				},
				titleSource: (pane) => {
					const id = paneTerminalId(pane);
					return id
						? {
								subscribe: (callback) =>
									registry.onTitleChange(id, callback, pane.id),
								getSnapshot: () => registry.getTitle(id, pane.id) ?? undefined,
							}
						: undefined;
				},
				renderPane: (context) => {
					const terminalId = paneTerminalId(context.pane);
					if (!terminalId) return null;
					return (
						<JedvTerminalPane
							terminalId={terminalId}
							context={context}
							connection={latest.current.connection}
							workspaceId={latest.current.workspaceId}
							client={latest.current.client}
							remote={latest.current.remote}
							active={props.active}
							searchOpen={searchPane === context.pane.id}
							onSearchClose={() => setSearchPane(null)}
							onOpenFile={(path, pinned) =>
								latest.current.onOpenFile(path, pinned)
							}
							onOpenUrl={(url, placement) =>
								latest.current.onOpenUrl?.(url, placement)
							}
							onConnectionChange={(connected) => {
								if (latest.current.focused !== false && latest.current.active)
									latest.current.onConnectionChange(connected);
							}}
							onNewShell={async () => {
								const current = latest.current;
								const seed = registry.prepareReplacement(
									terminalId,
									context.pane.id,
									t({ message: "New shell" }),
								);
								const session =
									await current.client.terminal.createSession.mutate({
										workspaceId: current.workspaceId,
									});
								await current.onCreated();
								if (!mounted.current) return;
								const found = store.getState().getPane(context.pane.id);
								if (!found) return;
								seed(session.terminalId);
								store.getState().replacePane({
									tabId: found.tabId,
									paneId: context.pane.id,
									newPane: {
										id: context.pane.id,
										kind: "terminal",
										data: { terminalId: session.terminalId },
										pinned: true,
									},
								});
								current.onSelect(session.terminalId);
							}}
						/>
					);
				},
				onBeforeClose: (pane) => {
					report(() => detachTerminalPane(store, pane.id));
					return false;
				},
			},
			files: {
				keepAlive: true,
				getTitle: () => t({ message: "Files" }),
				getIcon: () => <LuFolderOpen className="size-3.5" />,
				renderPane: (context) => (
					<FilesPaneSlot
						host={latest.current.filesHost}
						active={props.active && context.isActive}
						onActivate={() => latest.current.onOpenFile("")}
					/>
				),
				onBeforeClose: () => true,
			},
			changes: {
				getTitle: () => t({ message: "Changes" }),
				renderPane: (context) => (
					<JedvChangesView
						client={latest.current.client}
						hostUrl={latest.current.hostUrl}
						workspaceId={latest.current.workspaceId}
						active={latest.current.active && context.isActive}
						remote={latest.current.remote}
						onOpenFile={(path, pinned) =>
							latest.current.onOpenFile(path, pinned)
						}
						getHasUnsavedFiles={() =>
							latest.current.getHasUnsavedFiles?.() ?? true
						}
					/>
				),
				onBeforeClose: (pane) => {
					report(() => detachTerminalPane(store, pane.id));
					return false;
				},
			},
		}),
		[
			store,
			t,
			searchPane,
			props.active,
			props.agentByTerminal,
			props.agentProjectionReady,
		],
	);

	const moveActions = (
		context: RendererContext<WorkspacePaneData>,
	): ContextMenuActionConfig<WorkspacePaneData>[] =>
		props.otherArea
			? [
					{ key: "area-move-separator", type: "separator" },
					{
						key: "area-move",
						label:
							props.area === "right"
								? t({ message: "Move to Left Side" })
								: t({ message: "Move to Right Side" }),
						icon:
							props.area === "right" ? (
								<LuArrowLeftToLine />
							) : (
								<LuArrowRightToLine />
							),
						onSelect: () =>
							report(
								() =>
									props.otherArea &&
									moveWorkspacePane(store, props.otherArea, context.pane.id),
							),
					},
				]
			: [];
	const contextActions = (
		context: RendererContext<WorkspacePaneData>,
	): ContextMenuActionConfig<WorkspacePaneData>[] => {
		const id = paneTerminalId(context.pane);
		if (!id) return [];
		const instance = context.pane.id;
		const link = () => terminalContextMenuLinkStore.get(instance);
		const copyText = (text: string) =>
			report(() => writeTerminalClipboard(text));
		const canSplit = Object.keys(context.tab.panes).length < 8;
		return [
			{
				key: "copy",
				label: t({ message: "Copy" }),
				icon: <LuClipboardCopy />,
				shortcut: `${chromeKey()}C`,
				disabled: () => !registry.getSelection(id, instance),
				onSelect: () => copyText(registry.getSelection(id, instance)),
			},
			{
				key: "paste",
				label: t({ message: "Paste" }),
				icon: <LuClipboard />,
				shortcut: `${chromeKey()}V`,
				disabled: () => registry.getConnectionState(id, instance) !== "open",
				onSelect: () =>
					report(async () => {
						const text = await navigator.clipboard.readText();
						registry.paste(id, text, instance);
					}),
			},
			{ key: "sep-clip", type: "separator" },
			{
				key: "find",
				label: t({ message: "Find in Terminal" }),
				icon: <LuSearch />,
				shortcut: find,
				onSelect: () => setSearchPane(instance),
			},
			{
				key: "clear",
				label: t({ message: "Clear Terminal" }),
				icon: <LuEraser />,
				shortcut: clear,
				onSelect: () => registry.clear(id, instance),
			},
			{
				key: "scroll",
				label: t({ message: "Scroll to Bottom" }),
				icon: <LuArrowDownToLine />,
				shortcut: scroll,
				onSelect: () => registry.scrollToBottom(id, instance),
			},
			{ key: "sep-links", type: "separator", hidden: () => !link() },
			{
				key: "open-in",
				label: t({ message: "Open in" }),
				icon: <LuExternalLink />,
				hidden: () => !link(),
				children: () => terminalContextMenuLinkStore.getActions(instance),
			},
			{
				key: "copy-link",
				label: t({ message: "Copy Link" }),
				icon: <LuLink />,
				hidden: () => link()?.kind !== "url",
				onSelect: () => {
					const current = link();
					if (current?.kind === "url") copyText(current.url);
				},
			},
			{
				key: "copy-path",
				label: t({ message: "Copy Path" }),
				icon: <LuCopy />,
				hidden: () => {
					const current = link();
					return current?.kind !== "file" || !current.resolvedPath;
				},
				onSelect: () => {
					const current = link();
					if (current?.kind === "file" && current.resolvedPath)
						copyText(current.resolvedPath);
				},
			},
			{ key: "sep-ids", type: "separator" },
			{
				key: "terminal-id",
				label: t({ message: "Copy terminal ID" }),
				icon: <LuCopy />,
				onSelect: () => copyText(id),
			},
			{
				key: "agent-id",
				label: t({ message: "Copy agent session ID" }),
				icon: <LuCopy />,
				hidden: () => !latest.current.agentSessionByTerminal.get(id),
				onSelect: () => {
					const native = latest.current.agentSessionByTerminal.get(id);
					if (native) copyText(native);
				},
			},
			{ key: "sep-layout", type: "separator" },
			{
				key: "split-horizontal",
				label: t({ message: "Split Horizontally" }),
				icon: <LuRows2 />,
				shortcut: down,
				disabled: !canSplit,
				onSelect: () => report(() => splitRef.current("bottom", context)),
			},
			{
				key: "split-vertical",
				label: t({ message: "Split Vertically" }),
				icon: <LuColumns2 />,
				shortcut: right,
				disabled: !canSplit,
				onSelect: () => report(() => splitRef.current("right", context)),
			},
			{
				key: "equalize",
				label: t({ message: "Equalize Pane Splits" }),
				icon: <LuEqual />,
				shortcut: equal,
				disabled: Object.keys(context.tab.panes).length < 2,
				onSelect: () => store.getState().equalizeTab({ tabId: context.tab.id }),
			},
			{ key: "sep-move", type: "separator" },
			{
				key: "move-tab",
				label: t({ message: "Move to Tab" }),
				icon: <LuMoveRight />,
				children: () => [
					...store
						.getState()
						.tabs.filter((tab) => tab.id !== context.tab.id)
						.map((tab) => ({
							key: tab.id,
							label:
								tab.titleOverride ??
								Object.values(tab.panes)[0]?.titleOverride ??
								t({ message: "Terminal" }),
							onSelect: () =>
								store
									.getState()
									.movePaneToTab({ paneId: instance, targetTabId: tab.id }),
						})),
					{
						key: "new-tab",
						label: t({ message: "New Tab" }),
						icon: <LuPlus />,
						disabled: Object.keys(context.tab.panes).length === 1,
						onSelect: () =>
							store.getState().movePaneToNewTab({ paneId: instance }),
					},
				],
			},
			{ key: "sep-close", type: "separator" },
			{
				key: "close-view",
				label: t({ message: "Close View" }),
				icon: <LuX />,
				shortcut: close,
				onSelect: () => report(() => detachTerminalPane(store, instance)),
			},
			{
				key: "kill",
				label: t({ message: "Kill Terminal Session" }),
				icon: <LuPower />,
				variant: "destructive",
				disabled: () =>
					!latest.current.sessions?.some(
						(session) => session.terminalId === id,
					),
				onSelect: () => latest.current.onKill(id),
			},
		];
	};
	return (
		<div
			className="flex h-full min-h-0 min-w-0 flex-1"
			style={{ paddingRight: props.contentInsetRight }}
			data-jedv-focused-area={props.focused !== false ? "true" : undefined}
			onPointerDownCapture={props.onAreaFocus}
			onFocusCapture={props.onAreaFocus}
		>
			<DndProvider backend={HTML5Backend}>
				<Workspace
					store={store}
					registry={registryDefinition}
					isFocused={props.active && props.focused !== false}
					keepAliveTabs={3}
					className="min-h-0 flex-1"
					renderEmptyState={() => props.emptyState}
					renderTabBar={(bar) =>
						props.tabBarMount ? createPortal(bar, props.tabBarMount) : null
					}
					renderTabBarTrailing={() => props.toolbar}
					tabBarClassName="h-full min-h-0 flex-1 border-b-0"
					onAddTab={props.onNew}
					onBeforeCloseTab={(tab) => {
						report(() => detachTerminalTab(store, tab.id));
						return false;
					}}
					renderTabAccessory={(tab) => (
						<TerminalTabActivity
							hostUrl={props.hostUrl}
							workspaceId={props.workspaceId}
							terminalIds={Object.values(tab.panes).flatMap((pane) => {
								const id = paneTerminalId(pane);
								return id ? [id] : [];
							})}
							events={props.agentBindings ?? []}
							paneCount={Object.keys(tab.panes).length}
						/>
					)}
					renderAddTabMenu={({ runAfterClose }) => (
						<>
							<DropdownMenuItem
								onSelect={() => runAfterClose(() => latest.current.onNew())}
							>
								<LuPlus />
								<Trans>New Terminal</Trans>
								{newTerminalShortcut !== "Unassigned" && (
									<DropdownMenuShortcut>
										{newTerminalShortcut}
									</DropdownMenuShortcut>
								)}
							</DropdownMenuItem>

							<DropdownMenuItem
								onSelect={() => runAfterClose(() => openChangesTab(store))}
							>
								<LuGitCompareArrows />
								<Trans>Changes</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() =>
									runAfterClose(() => {
										latest.current.onOpenFile("");
									})
								}
							>
								<LuFolderOpen />
								<Trans>Files</Trans>
							</DropdownMenuItem>
							{props.sessionsMenu}
							{props.agentConfigs.map((config) => (
								<DropdownMenuItem
									key={config.id}
									onSelect={() =>
										runAfterClose(() => latest.current.onLaunch(config))
									}
								>
									<AgentIcon
										presetId={config.presetId}
										iconId={config.iconId}
										className="size-4"
									/>
									{config.label}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={showScripts.data ?? true}
								onCheckedChange={(checked) => {
									void electronTrpcClient.settings.setShowPresetsBar
										.mutate({ enabled: checked === true })
										.then(() =>
											settingsUtils.settings.getShowPresetsBar.invalidate(),
										)
										.catch((error) => toast.error(String(error)));
								}}
							>
								<Trans>Show Scripts Bar</Trans>
							</DropdownMenuCheckboxItem>
						</>
					)}
					paneActions={(context) => [
						{
							key: "split-right",
							icon: <LuColumns2 />,
							tooltip: t({ message: "Split Right" }),
							onClick: () => report(() => splitRef.current("right", context)),
						},
						{
							key: "split-down",
							icon: <LuRows2 />,
							tooltip: t({ message: "Split Down" }),
							onClick: () => report(() => splitRef.current("bottom", context)),
						},
						{
							key: "close",
							icon: <LuX />,
							tooltip: t({ message: "Close View" }),
							onClick: () =>
								report(() => detachTerminalPane(store, context.pane.id)),
						},
					]}
					contextMenuActions={(context) => {
						const base = contextActions(context);
						const move = moveActions(context);
						return base.length
							? [...base, ...move]
							: move.filter((action) => action.type !== "separator");
					}}
				/>
			</DndProvider>
		</div>
	);
}
function chromeKey() {
	return navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";
}

const report = (action: () => void | Promise<void>) => {
	try {
		void Promise.resolve(action()).catch((error) =>
			toast.error(error instanceof Error ? error.message : String(error)),
		);
	} catch (error) {
		toast.error(error instanceof Error ? error.message : String(error));
	}
};
