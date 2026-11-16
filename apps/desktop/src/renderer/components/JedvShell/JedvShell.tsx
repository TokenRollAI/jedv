import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import { getPresetById } from "@jedv/shared/host-agent-presets";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@jedv/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@jedv/ui/popover";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@jedv/ui/resizable";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuMaximize2, LuMinimize2, LuSearch, LuX } from "react-icons/lu";
import { VscFolderOpened, VscNewFolder } from "react-icons/vsc";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { ContentBoundary } from "renderer/components/ContentBoundary";
import { ThemedToaster } from "renderer/components/ThemedToaster";
import { UpdatesPill } from "renderer/components/UpdatesPill";
import { useSettingsExternalChangeListener } from "renderer/hooks/useSettingsExternalChangeListener";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { getAgentCommandText } from "renderer/lib/agent-launch-command";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { FONT_SETTINGS_QUERY_KEY } from "renderer/lib/font-settings";
import { resolvePresetAgentLink } from "renderer/lib/linked-terminal-presets";
import { buildTerminalCommand } from "renderer/lib/terminal/launch-command";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useSettings } from "renderer/stores/settings";
import { useTerminalCloseConfirmStore } from "renderer/stores/terminal-close-confirm/store";
import { useTheme } from "renderer/stores/theme/store";
import { isWithinWorkspacePath } from "shared/absolute-paths";
import { LOCAL_HOST_NAMESPACE } from "shared/jedv";
import type { MainLocalEvent, MainSettingsSection } from "shared/main-events";
import { useStore } from "zustand";
import { isLoopbackBrowserUrl } from "./browser-links";
import { ActiveWorkspaceSwitcher } from "./components/ActiveWorkspaceSwitcher";
import { ActivityPanelAside } from "./components/ActivityPanelAside";
import { ButlerNavigation } from "./components/ButlerNavigation";
import { ButlerView } from "./components/ButlerView";
import { CreateTeamView } from "./components/CreateTeamView";
import { CreateWorkspaceDialog } from "./components/CreateWorkspaceDialog";
import { DeclarativeDataSlots } from "./components/DeclarativeDataSlots";
import {
	AgentSetupGuard,
	useAgentLaunchGuard,
} from "./components/JedvAgentLaunchBar";
import { JedvAutomationsView } from "./components/JedvAutomationsView";
import { JedvCommandPalette } from "./components/JedvCommandPalette";
import { rememberPaletteFile } from "./components/JedvCommandPalette/recent";
import { JedvConfirmDialog } from "./components/JedvConfirmDialog";
import type { Confirmation } from "./components/JedvConfirmDialog/JedvConfirmDialog";
import {
	JedvDeleteWorkspaceDialog,
	RestoreWorkspaceButton,
} from "./components/JedvDeleteWorkspaceDialog";
import { JedvEmptyState } from "./components/JedvEmptyState";
import { JedvFilesView } from "./components/JedvFilesView";
import { JedvHostMenu } from "./components/JedvHostMenu";
import {
	JedvProjectActions,
	type JedvProjectActionsHandle,
	JedvProjectMenuItems,
	type ProjectActionContext,
	type ProjectActionKind,
	ProjectAppearanceDialog,
	ProjectRemovalDialog,
} from "./components/JedvProjectActions";
import { JedvProjectRun } from "./components/JedvProjectRun";
import { ProjectScriptsDialog } from "./components/JedvProjectRun/components/ProjectScriptsDialog";
import { JedvProjectTree } from "./components/JedvProjectTree";
import { workspaceAgentSessions } from "./components/JedvProjectTree/components/ProjectTreeWorkspace/session-rows";
import { JedvPullRequestsView } from "./components/JedvPullRequestsView";
import { JedvReleaseNotes } from "./components/JedvReleaseNotes";
import { JedvResourceSummary } from "./components/JedvResourceSummary";
import { JedvSettingsView } from "./components/JedvSettingsView";
import { JedvSidebarHeader } from "./components/JedvSidebarHeader";
import { JedvSidebarNav } from "./components/JedvSidebarNav";
import { JedvTeamworkView } from "./components/JedvTeamworkView";
import { JedvTerminalTabStrip } from "./components/JedvTerminalTabStrip";
import { useTerminalSessionsMenu } from "./components/JedvTerminalTabStrip/components/TerminalSessionsMenu";
import {
	JedvTerminalWorkspace,
	type TerminalWorkspaceActions,
} from "./components/JedvTerminalWorkspace";
import { filesSurfaceMatches } from "./components/JedvTerminalWorkspace/components/FilesPaneSlot/FilesPaneSlot";
import {
	attachTerminalSession,
	findTerminalPane,
	focusWorkspacePane,
	isTerminalPane,
	openChangesTab,
	openFilesTab,
	paneTerminalId,
	retainTerminalWorkspaceStore,
	terminalWorkspaceStore,
	workspacePaneAreas,
} from "./components/JedvTerminalWorkspace/layout";
import { getPresetLaunchPlan } from "./components/JedvTerminalWorkspace/preset-launch";
import { stepTerminalFontSize } from "./components/JedvTerminalWorkspace/stepTerminalFontSize";
import { JedvUsageView } from "./components/JedvUsageView";
import { JedvWelcome } from "./components/JedvWelcome";
import { JedvWorkspaceActivity } from "./components/JedvWorkspaceActivity";
import {
	JedvWorkspacesBoard,
	markWorkspaceRead,
	reconcileWorkspaceReadReceipts,
} from "./components/JedvWorkspacesBoard";
import {
	type ExistingAgentSelection,
	NativeAgentControls,
} from "./components/NativeAgentControls";
import { PrivateConnectionDialog } from "./components/PrivateConnectionDialog";
import { ProjectSettings } from "./components/ProjectSettings";
import { ProjectSortMenu } from "./components/ProjectSortMenu";
import { RightSidebarToggle } from "./components/RightSidebarToggle";
import { SidebarSectionHeading } from "./components/SidebarSectionHeading";
import { TeamworkDirectory } from "./components/TeamworkDirectory";
import {
	useWindowChromeMetrics,
	WindowChrome,
	WindowChromeContext,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "./components/WindowChrome";
import { WorkspaceForwards } from "./components/WorkspaceForwards";
import { WorkspaceToolbarSlot } from "./components/WorkspaceToolbarSlot";
import { useAgentIslandBridge } from "./hooks/useAgentIslandBridge";
import { useButlerInbox } from "./hooks/useButlerInbox";
import { useJedvHotkeys } from "./hooks/useJedvHotkeys";
import {
	ensureJedvLayoutRestored,
	useJedvLayoutPersistence,
} from "./hooks/useJedvLayoutPersistence";
import { useJedvNavigation } from "./hooks/useJedvNavigation";
import {
	historyLocation,
	pushShellLocation,
	type ShellHistory,
	type ShellLocation,
} from "./hooks/useJedvNavigation/history";
import { useNewAgentTabs } from "./hooks/useNewAgentTabs";
import { usePaneLayoutBridge } from "./hooks/usePaneLayoutBridge";
import { useResumedTerminalPanes } from "./hooks/useResumedTerminalPanes";
import { useTeamwork } from "./hooks/useTeamwork";
import { useWorkspaceReadReceiptSync } from "./hooks/useWorkspaceReadReceiptSync";
import {
	createLocalClient,
	hostBaseUrl,
	type LocalConnection,
} from "./local-client";
import type {
	JedvParityViewContext,
	JedvSettingsSection,
	JedvSurface,
} from "./parity-types";
import {
	finishTerminalResult,
	isCurrentTerminalContext,
	type TerminalResultContext,
} from "./terminal-result";
import {
	focusTerminal,
	type HostAgentConfig,
	type NativeProvider,
	type NativeState,
	type Project,
	type Workspace,
} from "./types";
import { supportsGit, supportsPullRequests } from "./vcs-capabilities";
import "./jedv-shell.css";

export function JedvShell() {
	const { t } = useLingui();
	useSettingsExternalChangeListener();
	const readReceiptSync = useWorkspaceReadReceiptSync();
	const queryClient = useQueryClient();
	const utils = electronTrpc.useUtils();
	const theme = useTheme();
	const connection = electronTrpc.hostServiceCoordinator.getConnection.useQuery(
		{ organizationId: LOCAL_HOST_NAMESPACE },
		{ refetchInterval: 2_000 },
	);
	const chrome = useWindowChromeMetrics();
	const restart = electronTrpc.hostServiceCoordinator.restart.useMutation();
	const disconnect =
		electronTrpc.hostServiceCoordinator.disconnectPrivateHost.useMutation();
	const copy = electronTrpc.external.copyText.useMutation();
	const finder = electronTrpc.external.openFolderInFinder.useMutation();
	const [navigation, setNavigation, navigationStatus] = useJedvNavigation();
	const [navigationApplied, setNavigationApplied] = useState(false);
	const [remote, setRemote] = useState<LocalConnection | null>(null);
	const activeConnection = remote ?? connection.data;
	const hostUrl = activeConnection ? hostBaseUrl(activeConnection) : null;
	const logicalHostId = remote
		? `private:${hostBaseUrl(remote)}`
		: `local:${LOCAL_HOST_NAMESPACE}`;

	const client = useMemo(
		() => (activeConnection ? createLocalClient(activeConnection) : null),
		[activeConnection],
	);
	const projectActionsRef = useRef<JedvProjectActionsHandle>(null);
	const projectContext = useMemo<ProjectActionContext | null>(
		() =>
			client && hostUrl
				? {
						client,
						hostUrl,
						hostLabel: remote
							? new URL(hostUrl).host
							: t({ message: "This device" }),
						isRemote: !!remote,
					}
				: null,
		[client, hostUrl, remote, t],
	);
	const currentHost = useRef({ client, hostUrl });
	currentHost.current = { client, hostUrl };
	const openProjectShortcut = useHotkeyDisplay("OPEN_PROJECT").text;
	const [projectSettingsTarget, setProjectSettingsTarget] = useState<{
		context: ProjectActionContext;
		project: Project;
	} | null>(null);
	const filterButton = useRef<HTMLButtonElement>(null);
	const [appearanceTarget, setAppearanceTarget] = useState<{
		context: ProjectActionContext;
		project: Project;
	} | null>(null);
	const [removalTarget, setRemovalTarget] = useState<{
		context: ProjectActionContext;
		project: Project;
	} | null>(null);
	const projectAction = (kind: ProjectActionKind, path?: string) =>
		projectActionsRef.current?.open(kind, path);

	const navigationSequence = useRef(0);
	const knownConnections = useRef(new Map<string, LocalConnection>());
	if (connection.data)
		knownConnections.current.set(hostBaseUrl(connection.data), connection.data);
	if (remote) knownConnections.current.set(hostBaseUrl(remote), remote);
	while (knownConnections.current.size > 8) {
		const oldest = knownConnections.current.keys().next().value;
		if (oldest) knownConnections.current.delete(oldest);
	}
	const [settingsSection, setSettingsSection] =
		useState<JedvSettingsSection>("agents");
	const [resourcesOpen, setResourcesOpen] = useState(false);
	const [activeSwitcherOpen, setActiveSwitcherOpen] = useState(false);
	const [welcomeReplay, setWelcomeReplay] = useState(false);
	const onboarding = electronTrpc.uiState.onboarding.get.useQuery(undefined, {
		retry: false,
	});
	const finishWelcome = async () => {
		await electronTrpcClient.uiState.onboarding.complete.mutate();
		await utils.uiState.onboarding.get.invalidate();
		setWelcomeReplay(false);
	};
	const history = useRef<ShellHistory>({ entries: [], index: -1 });
	const [, setHistoryRevision] = useState(0);
	const replayLocation = useRef<ShellLocation | null>(null);
	const pendingLocalPath = useRef<{
		path: string;
		pathType: "file" | "directory";
	} | null>(null);
	const [localPathRevision, setLocalPathRevision] = useState(0);

	const [surface, setSurface] = useState<JedvSurface>("terminal");
	const [teamSelection, setTeamSelection] = useState<{
		hostId: string;
		id: string;
	} | null>(null);
	const teamwork = useTeamwork(
		client,
		hostUrl,
		activeConnection?.secret ?? null,
	);
	const selectedTeamId =
		teamSelection?.hostId === logicalHostId
			? teamSelection.id
			: (teamwork.list.data?.find((team) => team.status !== "archived")?.id ??
				null);
	const openTeam = (id: string) => {
		if (hostUrl) setTeamSelection({ hostId: logicalHostId, id });
		navigate("teamwork");
	};
	const priorSurface = useRef<JedvSurface>("terminal");
	const [fileTarget, setRawFileTarget] = useState<{
		hostUrl: string;
		workspaceId: string;
		path?: string;
		pinned?: boolean;
		requestId?: number;
	} | null>(null);
	const setFileTarget = useCallback(
		(next: typeof fileTarget) =>
			setRawFileTarget((previous) =>
				next ? { ...next, requestId: (previous?.requestId ?? 0) + 1 } : null,
			),
		[],
	);
	const fileTargetRef = useRef(fileTarget);
	fileTargetRef.current = fileTarget;
	const [filesDirty, setFilesDirty] = useState(false);
	const filesDirtyRef = useRef(filesDirty);
	filesDirtyRef.current = filesDirty;
	const navigate = (next: JedvSurface) => {
		navigationSequence.current += 1;
		if (next === "settings" && surface !== "settings")
			priorSurface.current = surface;
		setSurface(next);
	};
	const [workspaceId, setWorkspaceId] = useState<string | null>(
		navigation.workspaceId,
	);
	const [terminalId, setTerminalId] = useState<string | null>(
		navigation.terminalId,
	);
	const terminalStore = useMemo(
		() =>
			terminalWorkspaceStore(
				`${hostUrl ?? "disconnected"}:${workspaceId ?? "none"}`,
			),
		[hostUrl, workspaceId],
	);
	useEffect(() => retainTerminalWorkspaceStore(terminalStore), [terminalStore]);
	const areas = useMemo(
		() => workspacePaneAreas(terminalStore),
		[terminalStore],
	);
	const rightStore = areas.right;
	const areaState = useStore(areas.state);
	const rightTabs = useStore(rightStore, (state) => state.tabs);
	const rightActiveTabId = useStore(rightStore, (state) => state.activeTabId);
	const priorRightTabs = useRef({ store: rightStore, count: rightTabs.length });
	useEffect(() => {
		const previous = priorRightTabs.current;
		priorRightTabs.current = { store: rightStore, count: rightTabs.length };
		if (
			previous.store === rightStore &&
			previous.count > 0 &&
			rightTabs.length === 0
		)
			areas.state.setState({ rightAreaOpen: false, focusedArea: "left" });
	}, [rightStore, rightTabs.length, areas.state]);
	const [workspaceElement, setWorkspaceElement] = useState<HTMLElement | null>(
		null,
	);
	const [workspaceWidth, setWorkspaceWidth] = useState(0);
	useEffect(() => {
		if (!workspaceElement) return;
		const measure = () => setWorkspaceWidth(workspaceElement.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(workspaceElement);
		return () => observer.disconnect();
	}, [workspaceElement]);
	const leftPanelRef = useRef<ImperativePanelHandle>(null);
	const [rightPanel, setRightPanel] = useState<ImperativePanelHandle | null>(
		null,
	);
	const [maximizedStore, setMaximizedStore] = useState<
		typeof terminalStore | null
	>(null);
	const rightMaximized = maximizedStore === rightStore;
	useEffect(() => {
		if (rightMaximized && areaState.rightAreaOpen) {
			leftPanelRef.current?.collapse();
			rightPanel?.resize(100);
		} else if (leftPanelRef.current?.isCollapsed()) {
			leftPanelRef.current.expand(60);
			if (areaState.rightAreaOpen) rightPanel?.resize(40);
		}
		if (!areaState.rightAreaOpen && rightMaximized) setMaximizedStore(null);
	}, [rightMaximized, areaState.rightAreaOpen, rightPanel]);
	const focusedStore =
		areaState.rightAreaOpen && areaState.focusedArea === "right"
			? rightStore
			: terminalStore;
	const [toolbarHost] = useState(() => {
		const node = document.createElement("div");
		node.className = "flex items-center gap-1";
		return node;
	});
	const [filesHost] = useState(() => {
		const node = document.createElement("div");
		node.className = "flex h-full min-h-0 min-w-0 flex-1";
		return node;
	});
	useEffect(() => {
		if (areaState.rightAreaOpen) {
			if (rightPanel?.isCollapsed()) rightPanel.expand(40);
		} else rightPanel?.collapse();
	}, [areaState.rightAreaOpen, rightPanel]);
	const shortcutWorkspaceIds = useRef<string[]>([]);
	const recordShortcutOrder = useCallback((ids: string[]) => {
		shortcutWorkspaceIds.current = ids;
	}, []);
	const [activityDockTarget, setActivityDockTarget] =
		useState<HTMLElement | null>(null);
	const [activityFits, setActivityFits] = useState(false);
	const [rightTabBarMount, setRightTabBarMount] =
		useState<HTMLDivElement | null>(null);
	const [tabBarMount, setTabBarMount] = useState<HTMLDivElement | null>(null);
	const terminalTabs = useStore(terminalStore, (state) => state.tabs);
	const activeTabId = useStore(terminalStore, (state) => state.activeTabId);

	const currentTerminalContext = useRef<TerminalResultContext | null>(null);
	const launchGuard = useAgentLaunchGuard({ client, hostUrl });
	currentTerminalContext.current =
		client && hostUrl && workspaceId ? { client, hostUrl, workspaceId } : null;
	const [scriptTarget, setScriptTarget] = useState<{
		context: TerminalResultContext;
		projectId: string;
	} | null>(null);
	const [terminalConnected, setTerminalConnected] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [workspaceCreation, setWorkspaceCreation] = useState<{
		context: ProjectActionContext;
		projects: (Pick<Project, "id" | "name"> &
			Partial<Pick<Project, "vcsKind" | "capabilities">>)[];
		projectId?: string;
		mode?: "new" | "local" | "import";
	} | null>(null);
	const setCreatingProjectId = (id: string | null | undefined) => {
		if (id === undefined) setWorkspaceCreation(null);
		else if (projectContext)
			setWorkspaceCreation({
				context: projectContext,
				projects: projects.data ?? [],
				projectId: id ?? undefined,
			});
	};
	const recentlyDeleted = useRef<
		{ context: ProjectActionContext; workspace: Workspace }[]
	>([]);
	const [restoreTarget, setRestoreTarget] = useState<{
		context: ProjectActionContext;
		workspace: Workspace;
	} | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<{
		context: ProjectActionContext;
		workspace: Workspace;
	} | null>(null);

	const [drawer, setDrawer] = useState(false);
	const workspaceActionsRef = useRef<HTMLButtonElement>(null);
	const workspaceActionsAnchor = useRef({
		getBoundingClientRect: () =>
			workspaceActionsRef.current?.getBoundingClientRect() ?? new DOMRect(),
	});
	const [activityPullRequest, setActivityPullRequest] = useState<{
		hostUrl: string;
		target: import("./components/JedvPullRequestsView/types").PullRequestTarget;
	} | null>(null);
	const changesOpen =
		areaState.rightAreaOpen &&
		rightTabs.some(
			(tab) =>
				tab.id === rightActiveTabId &&
				Object.values(tab.panes).some((pane) => pane.kind === "changes"),
		);
	const showChanges = (toggle = false) => {
		setSurface("terminal");
		if (useSettings.getState().changesOpenTarget === "tab")
			openChangesTab(focusedStore);
		else {
			const active = rightStore.getState().getActivePane();
			if (toggle && areaState.rightAreaOpen && active?.pane.kind === "changes")
				rightStore.getState().closePane({
					tabId: active.tabId,
					paneId: active.pane.id,
					intent: "remove",
				});
			else {
				areas.state.setState({ rightAreaOpen: true, focusedArea: "right" });
				openChangesTab(rightStore);
			}
		}
	};

	const [palette, setPalette] = useState<"commands" | "files" | null>(null);
	const leftLayoutRef = useRef<TerminalWorkspaceActions | null>(null);
	const rightLayoutRef = useRef<TerminalWorkspaceActions | null>(null);
	const terminalLayoutRef =
		areaState.rightAreaOpen && areaState.focusedArea === "right"
			? rightLayoutRef
			: leftLayoutRef;
	const forwardsOpenRef = useRef<(() => void) | null>(null);
	const runActionRef = useRef<(() => Promise<void>) | null>(null);
	const [nativeState, setNativeState] = useState<NativeState | null>(null);
	const [launched, setLaunched] = useState<{
		provider: NativeProvider;
		terminalId?: string;
		nativeSessionId?: string;
		agentConfigId?: string;
		chatSessionId?: string;
		bindingTerminalId?: string;
	} | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
	const [projectsCollapsed, setProjectsCollapsed] = useState(false);
	const [filterOpen, setFilterOpen] = useState(false);
	useEffect(() => {
		if (navigation.sidebarCollapsed) {
			setFilter("");
			setFilterOpen(false);
		}
	}, [navigation.sidebarCollapsed]);
	const [filter, setFilter] = useState("");
	const projects = useQuery({
		queryKey: ["jedv", hostUrl, "projects"],
		queryFn: client ? () => client.project.list.query() : skipToken,
	});
	const workspaces = useQuery({
		queryKey: ["jedv", hostUrl, "workspaces"],
		queryFn: client ? () => client.workspace.list.query() : skipToken,
		refetchInterval: 5_000,
	});
	const health = useQuery({
		queryKey: ["jedv", hostUrl, "health"],
		queryFn: client ? () => client.health.check.query() : skipToken,
		refetchInterval: 5_000,
		retry: false,
	});
	const terminals = useQuery({
		queryKey: ["jedv", hostUrl, "terminals", workspaceId],
		queryFn:
			client && workspaceId
				? () => client.terminal.list.query({ workspaceId })
				: skipToken,
		refetchInterval: 3_000,
	});
	const layoutSessions = useMemo(
		() => terminals.data?.sessions ?? [],
		[terminals.data],
	);
	const layoutPersistence = useJedvLayoutPersistence({
		client,
		store: terminalStore,
		hostUrl,
		workspaceId,
		sessions: layoutSessions,
		sessionsReady: terminals.isSuccess && !terminals.isPlaceholderData,
	});
	useEffect(() => {
		if (!layoutPersistence.ready || !terminalId || !terminals.isSuccess) return;
		if (findTerminalPane(terminalStore, terminalId)) return;
		setTerminalId(
			paneTerminalId(focusedStore.getState().getActivePane()?.pane),
		);
	}, [
		layoutPersistence.ready,
		terminalId,
		terminalStore,
		focusedStore,
		terminals.isSuccess,
	]);

	const bindings = useQuery({
		queryKey: ["jedv", hostUrl, "bindings"],
		queryFn: client ? () => client.terminalAgents.list.query() : skipToken,
		refetchInterval: 3_000,
	});
	useNewAgentTabs({
		store: terminalStore,
		hostUrl,
		workspaceId,
		ready:
			layoutPersistence.ready &&
			terminals.isSuccess &&
			!terminals.isPlaceholderData &&
			!terminals.isError &&
			bindings.isSuccess &&
			!bindings.isPlaceholderData &&
			!bindings.isError,
		sessions: layoutSessions,
		bindings: bindings.data ?? [],
	});
	const agentSessions = workspaceAgentSessions({
		store: terminalStore,
		sessions: layoutSessions,
		workspaceId,
		ready:
			layoutPersistence.ready &&
			terminals.isSuccess &&
			!terminals.isPlaceholderData,
		bindings: bindings.data ?? [],
		memberNames: new Map(
			teamwork.activeSnapshots.flatMap((snapshot) =>
				snapshot.members.flatMap((member) =>
					member.terminalId ? [[member.terminalId, member.name] as const] : [],
				),
			),
		),
	});
	const agentSessionNames = new Map(
		[...agentSessions].map(([id, row]) => [id, row.name]),
	);
	const workspace = workspaces.data?.find((item) => item.id === workspaceId);
	const project = projects.data?.find(
		(item) => item.id === workspace?.projectId,
	);
	const connected =
		!!client &&
		health.isSuccess &&
		!health.isError &&
		projects.isSuccess &&
		!projects.isError &&
		workspaces.isSuccess &&
		!workspaces.isError;
	useResumedTerminalPanes({
		client,
		hostUrl,
		workspaceId,
		store: terminalStore,
		sessions: layoutSessions,
		sessionsReady:
			terminals.isSuccess && !terminals.isPlaceholderData && !terminals.isError,
		layoutReady: layoutPersistence.ready,
		connected,
		getWsToken: () => activeConnection?.secret ?? null,
	});
	const butler = useButlerInbox(client, hostUrl, connected);
	const usageVisible = electronTrpc.settings.getShowUsageInSidebar.useQuery(
		undefined,
		{ refetchInterval: 3_000 },
	);
	const resourcesVisible =
		electronTrpc.settings.getShowResourceMonitor.useQuery(undefined, {
			refetchInterval: 3_000,
		});
	const showPresetsBar = electronTrpc.settings.getShowPresetsBar.useQuery();
	const presets = electronTrpc.settings.getTerminalPresets.useQuery();
	const matchingPresets = (presets.data ?? []).filter(
		(preset) =>
			!preset.projectIds?.length ||
			(!!project && preset.projectIds.includes(project.id)),
	);

	const agentConfigs = useQuery({
		queryKey: ["jedv", hostUrl, "agent-configs"],
		queryFn: client
			? () => client.settings.agentConfigs.list.query()
			: skipToken,
		refetchInterval: 3_000,
	});
	const configuredAgents = (agentConfigs.data ?? []).filter(
		(config) =>
			["codex", "claude", "agy", "kimi"].includes(config.presetId) ||
			getPresetById(config.presetId) === undefined,
	);

	const currentBindings =
		bindings.data?.filter((item) => item.workspaceId === workspaceId) ?? [];
	const agentByTerminal = new Map(
		currentBindings.map((item) => [item.terminalId, item.agentId]),
	);
	useEffect(() => {
		if (!navigationStatus.ready || navigationApplied || !hostUrl) return;
		if (navigation.hostUrl && navigation.hostUrl !== hostUrl) {
			setConnecting(true);
			setWorkspaceId(null);
			setTerminalId(null);
		} else {
			setWorkspaceId(navigation.workspaceId);
			setTerminalId(navigation.terminalId);
		}
		setNavigationApplied(true);
	}, [
		navigationStatus.ready,
		navigationApplied,
		hostUrl,
		navigation.hostUrl,
		navigation.workspaceId,
		navigation.terminalId,
	]);
	useEffect(() => {
		if (navigationApplied && connected && !connecting)
			setNavigation((previous) =>
				previous.hostUrl === hostUrl &&
				previous.workspaceId === workspaceId &&
				previous.terminalId === terminalId
					? previous
					: { ...previous, hostUrl, workspaceId, terminalId },
			);
	}, [
		navigationApplied,
		connected,
		connecting,
		workspaceId,
		terminalId,
		hostUrl,
		setNavigation,
	]);

	useEffect(() => {
		if (
			!client ||
			!navigationApplied ||
			connecting ||
			remote ||
			!workspaces.data ||
			workspaces.data.some((item) => item.id === workspaceId)
		)
			return;
		const first = workspaces.data[0];
		if (!first) {
			setWorkspaceId(null);
			setTerminalId(null);
			return;
		}
		let cancelled = false;
		void queryClient
			.fetchQuery({
				queryKey: ["jedv", hostUrl, "terminals", first.id],
				queryFn: () => client.terminal.list.query({ workspaceId: first.id }),
			})
			.then((result) => {
				if (cancelled) return;
				setWorkspaceId(first.id);
				setTerminalId(result.sessions[0]?.terminalId ?? null);
			})
			.catch((cause) => {
				if (!cancelled)
					setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [
		client,
		remote,
		workspaces.data,
		workspaceId,
		hostUrl,
		queryClient,
		navigationApplied,
		connecting,
	]);

	useEffect(() => {
		if (
			terminals.data &&
			terminalId &&
			!terminals.data.sessions.some((item) => item.terminalId === terminalId) &&
			!findTerminalPane(terminalStore, terminalId)
		)
			setTerminalId(null);
	}, [terminals.data, terminalId, terminalStore]);
	useEffect(() => {
		if (projects.data && !remote)
			setNavigation((previous) => {
				const valid = previous.collapsedProjects.filter((id) =>
					projects.data?.some((project) => project.id === id),
				);
				return valid.length === previous.collapsedProjects.length
					? previous
					: { ...previous, collapsedProjects: valid };
			});
	}, [projects.data, remote, setNavigation]);
	useEffect(() => {
		if (hostUrl && workspaces.isSuccess && workspaces.data)
			reconcileWorkspaceReadReceipts(
				hostUrl,
				workspaces.data.map((item) => item.id),
			);
	}, [hostUrl, workspaces.isSuccess, workspaces.data]);
	useEffect(() => {
		const acknowledge = () => {
			if (!hostUrl || !document.hasFocus()) return;
			const id =
				surface === "terminal"
					? workspaceId
					: surface === "files"
						? fileTarget?.workspaceId
						: null;
			if (!id) return;
			const row = workspaces.data?.find((item) => item.id === id);
			const observed = [
				row?.lastActivityAt,
				...(bindings.data ?? [])
					.filter((item) => item.workspaceId === id)
					.map((item) => item.lastEventAt),
			].filter(
				(value): value is number =>
					typeof value === "number" && Number.isFinite(value) && value > 0,
			);
			if (observed.length)
				markWorkspaceRead(hostUrl, id, Math.max(...observed));
		};
		acknowledge();
		window.addEventListener("focus", acknowledge);
		return () => window.removeEventListener("focus", acknowledge);
	}, [
		hostUrl,
		surface,
		workspaceId,
		fileTarget?.workspaceId,
		workspaces.data,
		bindings.data,
	]);

	useEffect(() => {
		if (!navigationApplied) return;
		const location: ShellLocation = {
			hostUrl,
			workspaceId,
			terminalId,
			surface,
			path: surface === "files" ? fileTarget?.path : undefined,
			pinned: surface === "files" ? fileTarget?.pinned : undefined,
		};
		const replay = replayLocation.current;
		if (replay) {
			if (
				replay.hostUrl === hostUrl &&
				replay.workspaceId === workspaceId &&
				replay.surface === surface
			)
				replayLocation.current = null;
			return;
		}
		const old = history.current.index;
		pushShellLocation(history.current, location);
		if (old !== history.current.index) setHistoryRevision((value) => value + 1);
	}, [
		navigationApplied,
		hostUrl,
		workspaceId,
		surface,
		fileTarget?.path,
		fileTarget?.pinned,
		terminalId,
	]);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		setDismissedFailure(null);
		try {
			await action();
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	};
	const refresh = async () => {
		await Promise.all([projects.refetch(), workspaces.refetch()]);
	};
	const selectTerminal = (id: string | null) => {
		if (id) {
			const existing = findTerminalPane(terminalStore, id);
			if (!existing) {
				const session = queryClient
					.getQueryData<{ sessions: import("./types").TerminalSession[] }>([
						"jedv",
						hostUrl,
						"terminals",
						workspaceId,
					])
					?.sessions.find((row) => row.terminalId === id);
				if (session) attachTerminalSession(terminalStore, session);
			} else if (
				(areas.state.getState().focusedArea === "right"
					? rightStore
					: terminalStore) !== existing.store ||
				paneTerminalId(existing.store.getState().getActivePane()?.pane) !== id
			)
				focusWorkspacePane(existing.store, existing.pane.id);
		}
		if (id !== terminalId) {
			setTerminalId(id);
			setTerminalConnected(false);
			setNativeState(null);
		}
		if (id) focusTerminal();
	};
	const openCompletedTerminal = (
		expected: TerminalResultContext,
		id: string | null,
	) =>
		finishTerminalResult(
			expected,
			id,
			currentTerminalContext,
			queryClient,
			(terminal) => {
				selectTerminal(terminal);
				setSurface("terminal");
			},
		);
	const selectExistingAgent = async (selection: ExistingAgentSelection) => {
		if (!client || !hostUrl || !workspaceId) return;
		const expected = { client, hostUrl, workspaceId };
		const commit = (id: string | null) => {
			if (!isCurrentTerminalContext(currentTerminalContext.current, expected))
				return;
			selectTerminal(id);
			setLaunched(
				selection.provider
					? {
							...selection,
							provider: selection.provider,
							terminalId: selection.terminalId ?? undefined,
						}
					: null,
			);
			setSurface("terminal");
			if (selection.source === "chat-session") setDrawer(true);
		};
		if (selection.source === "chat-session") commit(null);
		else
			await finishTerminalResult(
				expected,
				selection.terminalId,
				currentTerminalContext,
				queryClient,
				commit,
			);
	};
	const refreshTerminals = async (id: string) => {
		if (!client) return;
		await queryClient.cancelQueries({
			queryKey: ["jedv", hostUrl, "terminals", id],
			exact: true,
		});
		const result = await client.terminal.list.query({ workspaceId: id });
		queryClient.setQueryData(["jedv", hostUrl, "terminals", id], result);
		return result;
	};
	const openWorkspace = async (
		id: string,
		requestedTerminalId?: string | null,
	) => {
		if (!client) return;
		const request = ++navigationSequence.current;
		const result = await refreshTerminals(id);
		if (request !== navigationSequence.current) return;
		if (
			!result ||
			currentHost.current.client !== client ||
			currentHost.current.hostUrl !== hostUrl
		)
			return;
		if (!hostUrl) return;
		const store = terminalWorkspaceStore(`${hostUrl}:${id}`);
		await ensureJedvLayoutRestored({
			client,
			store,
			hostUrl,
			workspaceId: id,
			sessions: result.sessions,
			sessionsReady: true,
		});
		if (
			request !== navigationSequence.current ||
			currentHost.current.client !== client ||
			currentHost.current.hostUrl !== hostUrl
		)
			return;
		const explicit = requestedTerminalId
			? result.sessions.find(
					(session) => session.terminalId === requestedTerminalId,
				)
			: null;
		if (requestedTerminalId && !explicit)
			throw new Error(
				t({
					message:
						"This terminal has exited. Refresh the team to see its current status.",
				}),
			);
		if (explicit) attachTerminalSession(store, explicit);
		setWorkspaceId(id);
		setTerminalId(
			explicit?.terminalId ??
				paneTerminalId(store.getState().getActivePane()?.pane),
		);
		setTerminalConnected(false);
		setNativeState(null);
		setSurface("terminal");
		setLaunched(null);
	};
	usePaneLayoutBridge({
		localConnection: connection.data ?? null,
		activeWorkspaceId: !remote && surface === "terminal" ? workspaceId : null,
		getSidebarFullScreen: (id) =>
			!remote && id === workspaceId && rightMaximized,
		onFocusWorkspace: async (id) => {
			if (
				remote ||
				!connection.data ||
				hostUrl !== hostBaseUrl(connection.data)
			)
				throw new Error(
					t({
						message:
							"Open the local host before focusing a local workspace pane.",
					}),
				);
			if (filesDirtyRef.current)
				throw new Error(
					t({
						message:
							"Save or close the unsaved files before opening another workspace",
					}),
				);
			const expectedNavigation = navigationSequence.current + 1;
			await openWorkspace(id);
			if (
				navigationSequence.current !== expectedNavigation ||
				currentHost.current.hostUrl !== hostUrl ||
				currentHost.current.client !== client
			)
				throw new Error(
					t({
						message:
							"Navigation changed before the pane could be focused. Inspect the workspace before retrying.",
					}),
				);
		},
	});
	const island = useAgentIslandBridge({
		client,
		hostId: hostUrl,
		projects: projects.data ?? [],
		workspaces: workspaces.data ?? [],
		bindings: bindings.data ?? [],
		nativeState,
		activeWorkspaceId:
			surface === "terminal"
				? workspaceId
				: surface === "files"
					? (fileTarget?.workspaceId ?? null)
					: null,
		onFocus: async (event) => {
			if (!client || event.hostId !== hostUrl) return;
			setSurface("terminal");
			const sessions = await refreshTerminals(event.workspaceId);
			if (!sessions) return;
			setWorkspaceId(event.workspaceId);
			selectTerminal(
				event.terminalId &&
					sessions.sessions.some(
						(session) => session.terminalId === event.terminalId,
					)
					? event.terminalId
					: null,
			);
			setLaunched({
				provider: event.provider,
				agentConfigId: event.agentConfigId,
				chatSessionId: event.chatSessionId,
				bindingTerminalId: event.bindingTerminalId,
				nativeSessionId: event.nativeSessionId ?? undefined,
				terminalId: event.terminalId ?? undefined,
			});
			if (!event.terminalId) setDrawer(true);
			if (event.unavailable)
				toast.error(
					t({
						message:
							"The session changed. Select its current run in the workspace.",
					}),
				);
		},
	});

	const applyLocation = async (location: ShellLocation) => {
		if (
			filesDirtyRef.current &&
			(location.hostUrl !== hostUrl ||
				(location.surface === "files" &&
					location.workspaceId !== fileTarget?.workspaceId))
		)
			throw new Error(
				t({
					message:
						"Save or close the unsaved files before opening another workspace",
				}),
			);
		if (!location.hostUrl) return;
		const selected = knownConnections.current.get(location.hostUrl);
		if (!selected) throw new Error(t({ message: "Disconnected" }));
		const targetClient =
			location.hostUrl === hostUrl && client
				? client
				: createLocalClient(selected);
		const seq = ++navigationSequence.current;
		const [nextProjects, nextWorkspaces] = await Promise.all([
			targetClient.project.list.query(),
			targetClient.workspace.list.query(),
		]);
		const row = nextWorkspaces.find((item) => item.id === location.workspaceId);
		if (location.workspaceId && !row)
			throw new Error(t({ message: "Workspace not found" }));
		const sessions = row
			? await targetClient.terminal.list.query({ workspaceId: row.id })
			: null;
		if (seq !== navigationSequence.current) return;
		queryClient.setQueryData(
			["jedv", location.hostUrl, "projects"],
			nextProjects,
		);
		queryClient.setQueryData(
			["jedv", location.hostUrl, "workspaces"],
			nextWorkspaces,
		);
		if (row && sessions) {
			queryClient.setQueryData(
				["jedv", location.hostUrl, "terminals", row.id],
				sessions,
			);
			const store = terminalWorkspaceStore(`${location.hostUrl}:${row.id}`);
			await ensureJedvLayoutRestored({
				client: targetClient,
				store,
				hostUrl: location.hostUrl,
				workspaceId: row.id,
				sessions: sessions.sessions,
				sessionsReady: true,
			});
			if (seq !== navigationSequence.current) return;
			if (location.terminalId) {
				const terminal = sessions.sessions.find(
					(item) => item.terminalId === location.terminalId,
				);
				if (terminal) attachTerminalSession(store, terminal);
			}
		}
		const local = connection.data ? hostBaseUrl(connection.data) : null;
		setRemote(location.hostUrl === local ? null : selected);
		setWorkspaceId(row?.id ?? null);
		setTerminalId(
			location.terminalId &&
				sessions?.sessions.some(
					(item) => item.terminalId === location.terminalId,
				)
				? location.terminalId
				: null,
		);
		if (location.surface === "files" && row)
			setFileTarget({
				hostUrl: location.hostUrl,
				workspaceId: row.id,
				path: location.path,
				pinned: location.pinned,
			});
		setSurface(location.surface);
	};
	const moveHistory = async (direction: -1 | 1) => {
		const next = historyLocation(history.current, direction);
		if (!next) return;
		replayLocation.current = next.location;
		try {
			await applyLocation(next.location);
			history.current.index = next.index;
			setHistoryRevision((value) => value + 1);
		} catch (error) {
			replayLocation.current = null;
			throw error;
		}
	};
	const openSettings = (section?: MainSettingsSection) => {
		if (section === "integrations")
			throw new Error(t({ message: "Settings section unavailable" }));
		setSettingsSection(
			section === "project" || section === "workspace"
				? "projects"
				: section === "behavior"
					? "general"
					: (section ?? "agents"),
		);
		navigate("settings");
	};

	const eventIds = useRef(new Set<string>());
	const activeEvents = useRef(new Set<string>());
	const processLocalEvent = async (event: MainLocalEvent) => {
		if (activeEvents.current.has(event.id)) return;
		if (eventIds.current.has(event.id)) {
			await electronTrpcClient.window.ackLocalEvent.mutate({ id: event.id });
			return;
		}
		if (!navigationApplied) return;
		activeEvents.current.add(event.id);
		try {
			const target = event.target;
			if (target.kind === "settings") openSettings(target.section);
			else if (target.kind === "automations" || target.kind === "pull-requests")
				navigate(target.kind);
			else if (target.kind === "open-path") {
				if (filesDirtyRef.current)
					throw new Error(
						t({
							message:
								"Save or close the unsaved files before opening another workspace",
						}),
					);
				if (!connection.data) throw new Error(t({ message: "Disconnected" }));
				setRemote(null);
				pendingLocalPath.current = target;
				setLocalPathRevision((value) => value + 1);
			} else if (target.kind === "workspace")
				await applyLocation({
					hostUrl: target.hostUrl,
					workspaceId: target.workspaceId,
					terminalId: target.terminalId ?? null,
					surface: "terminal",
				});
			else {
				const selected = knownConnections.current.get(target.hostUrl);
				if (!selected) throw new Error(t({ message: "Disconnected" }));
				const source = createLocalClient(selected);
				const rows = await source.workspace.list.query();
				const checkout = rows.find(
					(row) => row.projectId === target.projectId && row.type === "local",
				);
				if (!checkout)
					throw new Error(
						t({ message: "Open a workspace for this project first" }),
					);
				await applyLocation({
					hostUrl: target.hostUrl,
					workspaceId: checkout.id,
					terminalId: null,
					surface: "terminal",
				});
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			activeEvents.current.delete(event.id);
			eventIds.current.add(event.id);
			if (eventIds.current.size > 64) {
				const oldest = eventIds.current.values().next().value;
				if (oldest) eventIds.current.delete(oldest);
			}
			await electronTrpcClient.window.ackLocalEvent.mutate({ id: event.id });
		}
	};
	electronTrpc.window.subscribeLocalEvents.useSubscription(undefined, {
		enabled: navigationApplied,
		onData: (event) => {
			void processLocalEvent(event).catch((error) =>
				toast.error(String(error)),
			);
		},
	});
	electronTrpc.menu.subscribe.useSubscription(undefined, {
		onData: (event) => {
			void run(async () => {
				if (event.type === "open-project") browse();
				else if (event.type === "open-settings")
					openSettings(event.data.section);
				else if (event.type === "open-workspace")
					await openWorkspace(event.data.workspaceId);
				else if (event.type === "check-resources") setResourcesOpen(true);
				else
					await electronTrpcClient.settings.setShowPresetsBar
						.mutate({ enabled: !(showPresetsBar.data ?? true) })
						.then(() => utils.settings.getShowPresetsBar.invalidate());
			});
		},
	});
	useEffect(() => {
		const target = localPathRevision > 0 ? pendingLocalPath.current : null;
		if (
			!target ||
			remote ||
			!connection.data ||
			hostUrl !== hostBaseUrl(connection.data) ||
			!client ||
			!workspaces.data
		)
			return;
		pendingLocalPath.current = null;
		if (target.pathType === "directory")
			projectActionsRef.current?.open("open", target.path);
		else {
			const row = [...workspaces.data]
				.filter(
					(row) =>
						row.worktreePath &&
						isWithinWorkspacePath(row.worktreePath, target.path),
				)
				.sort(
					(a, b) =>
						(b.worktreePath?.length ?? 0) - (a.worktreePath?.length ?? 0),
				)[0];
			if (!row) {
				toast.error(t({ message: "File is not in an open workspace" }));
				return;
			}
			setFileTarget({
				hostUrl,
				workspaceId: row.id,
				path: target.path,
				pinned: true,
			});
			setWorkspaceId(row.id);
			setSurface("files");
		}
	}, [
		localPathRevision,
		setFileTarget,
		client,
		hostUrl,
		remote,
		connection.data,
		workspaces.data,
		t,
	]);
	useEffect(() => {
		const publish = () => {
			const tabs =
				surface === "terminal" || surface === "files"
					? [
							terminalTabs.find((tab) => tab.id === activeTabId),
							...(areaState.rightAreaOpen
								? [rightTabs.find((tab) => tab.id === rightActiveTabId)]
								: []),
						].filter((tab) => !!tab)
					: [];
			const ids = tabs
				.flatMap((tab) =>
					Object.values(tab.panes)
						.filter(isTerminalPane)
						.map((pane) => pane.data.terminalId),
				)
				.slice(0, 32);

			void electronTrpcClient.notifications.publishVisibility
				.mutate({
					hostUrl,
					workspaceId:
						surface === "terminal" || surface === "files" ? workspaceId : null,
					visibleTerminalIds: ids,
				})
				.catch(() => {});
		};
		publish();
		window.addEventListener("focus", publish);
		window.addEventListener("blur", publish);
		document.addEventListener("visibilitychange", publish);
		return () => {
			window.removeEventListener("focus", publish);
			window.removeEventListener("blur", publish);
			document.removeEventListener("visibilitychange", publish);
			void electronTrpcClient.notifications.publishVisibility
				.mutate({ hostUrl: null, workspaceId: null, visibleTerminalIds: [] })
				.catch(() => {});
		};
	}, [
		hostUrl,
		workspaceId,
		surface,
		terminalTabs,
		activeTabId,
		rightTabs,
		rightActiveTabId,
		areaState.rightAreaOpen,
	]);

	const createTerminal = async (
		id = workspaceId,
		areaStore?: typeof terminalStore,
	) => {
		if (!client || !id || !hostUrl) return;
		const expected = { client, hostUrl, workspaceId: id };
		const request = ++navigationSequence.current;
		const session = await expected.client.terminal.createSession.mutate({
			workspaceId: id,
			themeType: theme?.type ?? "dark",
		});
		const result = await expected.client.terminal.list.query({
			workspaceId: id,
		});
		queryClient.setQueryData(["jedv", hostUrl, "terminals", id], result);
		const primaryStore = terminalWorkspaceStore(`${hostUrl}:${id}`);
		const targetStore =
			areaStore ?? (id === workspaceId ? focusedStore : primaryStore);
		await ensureJedvLayoutRestored({
			client,
			store: primaryStore,
			hostUrl,
			workspaceId: id,
			sessions: result.sessions,
			sessionsReady: true,
		});
		const live = result.sessions.find(
			(row) => row.terminalId === session.terminalId,
		);
		if (live) attachTerminalSession(targetStore, live);
		if (
			request !== navigationSequence.current ||
			currentHost.current.client !== client ||
			currentHost.current.hostUrl !== hostUrl
		)
			return;
		setWorkspaceId(id);
		setSurface("terminal");
		selectTerminal(session.terminalId);
	};

	const runPreset = async (preset: TerminalPreset) => {
		if (!client || !hostUrl || !workspaceId) return;
		const original = { client, hostUrl, workspaceId };
		const store = terminalStore;
		const liveConfigs = preset.agentId
			? await original.client.settings.agentConfigs.list.query()
			: [];
		if (!isCurrentTerminalContext(currentTerminalContext.current, original))
			return;
		const link = resolvePresetAgentLink(preset, liveConfigs, {
			remote: !!remote,
		});
		if (link.status !== "linked" && link.status !== "unlinked")
			throw new Error(
				t({
					message:
						"The linked local agent is unavailable on this host. Edit the preset or remove its agent link.",
				}),
			);
		if (
			link.status === "linked" &&
			!(await launchGuard.beforeLaunch(workspaceId))
		)
			return;
		if (!isCurrentTerminalContext(currentTerminalContext.current, original))
			return;
		const commands = (
			link.status === "linked"
				? [getAgentCommandText(link.agent)]
				: preset.commands
		).filter((command) => command.trim());
		if (!commands.length) return;
		const plan = getPresetLaunchPlan({
			mode: preset.executionMode ?? "new-tab",
			target: preset.executionMode === "split-pane" ? "active-tab" : "new-tab",
			commandCount: commands.length,
			hasActiveTab: !!store.getState().getActiveTab(),
		});
		const grouped =
			plan === "active-tab-multi-pane" ||
			plan === "new-tab-multi-pane" ||
			plan === "active-tab-single";
		const initialTab = plan.startsWith("active-tab")
			? store.getState().getActiveTab()
			: null;
		if (
			grouped &&
			commands.length +
				(initialTab ? Object.keys(initialTab.panes).length : 0) >
				8
		)
			throw new Error(
				t({ message: "A tab can contain at most eight terminal panes." }),
			);
		const sequential = buildTerminalCommand(commands);
		if (!sequential) return;
		const toRun =
			preset.executionMode === "sequential" ? [sequential] : commands;
		let anchor = initialTab?.activePaneId ?? null;
		let groupId = initialTab?.id ?? null;
		let lastId: string | null = null;
		try {
			for (const command of toRun) {
				const result = await original.client.terminal.launchSession.mutate({
					workspaceId: original.workspaceId,
					initialCommand: command,
					cwd: preset.cwd || undefined,
				});
				lastId = result.terminalId;
				if (grouped && anchor && groupId && store.getState().getPane(anchor))
					store.getState().splitPane({
						tabId: groupId,
						paneId: anchor,
						position: "right",
						newPane: {
							id: lastId,
							kind: "terminal",
							data: { terminalId: lastId },
							titleOverride: preset.name,
							pinned: true,
						},
					});
				else {
					store.getState().addTab({
						id: lastId,
						panes: [
							{
								id: lastId,
								kind: "terminal",
								data: { terminalId: lastId },
								titleOverride: preset.name,
								pinned: true,
							},
						],
						reuse: false,
						focus: false,
					});
					groupId = lastId;
				}
				anchor = lastId;
			}
		} finally {
			const result = await original.client.terminal.list.query({
				workspaceId: original.workspaceId,
			});
			queryClient.setQueryData(
				["jedv", original.hostUrl, "terminals", original.workspaceId],
				result,
			);
		}
		if (
			lastId &&
			isCurrentTerminalContext(currentTerminalContext.current, original)
		) {
			selectTerminal(lastId);
			setSurface("terminal");
		}
	};
	const zoom = async (direction: "in" | "out" | "reset") => {
		if (document.activeElement?.closest(".xterm")) {
			const settings =
				await electronTrpcClient.settings.getFontSettings.query();
			const next = stepTerminalFontSize(
				settings.terminalFontSize ?? null,
				direction,
			);
			if (next !== undefined) {
				await electronTrpcClient.settings.setFontSettings.mutate({
					terminalFontSize: next,
				});
				await queryClient.invalidateQueries({
					queryKey: FONT_SETTINGS_QUERY_KEY,
				});
			}
		} else await electronTrpcClient.window.zoom.mutate({ direction });
	};

	const openConfiguredUrl = async (url: string, forwarded = false) => {
		if (remote && !forwarded && isLoopbackBrowserUrl(url))
			throw new Error(
				t({
					message:
						"Open remote localhost links from Ports after forwarding the port.",
				}),
			);
		await electronTrpcClient.external.openUrl.mutate(url);
	};

	const openWorkspaceInEditor = async () => {
		if (!workspace?.worktreePath || !client || !hostUrl) return;
		if (remote)
			throw new Error(
				t({
					message: "External editors are available for local workspaces only.",
				}),
			);
		const original = { client, hostUrl, workspaceId: workspace.id };
		const editor = await electronTrpcClient.settings.getDefaultEditor.query();
		if (!isCurrentTerminalContext(currentTerminalContext.current, original))
			return;
		if (!editor) {
			setSettingsSection("files");
			navigate("settings");
			return;
		}
		await electronTrpcClient.external.openFileInEditor.mutate({
			path: workspace.worktreePath,
			app: editor,
		});
	};

	const launchConfiguredAgent = async (
		config: HostAgentConfig,
		id = workspaceId,
	) => {
		if (!client || !id || !hostUrl) return;
		const original = { client, hostUrl, workspaceId: id };
		const request = ++navigationSequence.current;
		const selectedWorkspace = workspaceId;
		if (!(await launchGuard.beforeLaunch(id))) return;
		if (
			request !== navigationSequence.current ||
			currentHost.current.client !== original.client ||
			currentHost.current.hostUrl !== original.hostUrl ||
			(currentTerminalContext.current?.workspaceId ?? null) !==
				selectedWorkspace
		)
			return;
		let selected: typeof launched = null;
		let terminal: string | null = null;
		if (["codex", "claude", "agy", "kimi"].includes(config.presetId)) {
			const provider = config.presetId as NativeProvider;
			const session =
				await original.client.terminalAgents.launchNativeSession.mutate({
					workspaceId: id,
					provider,
					agentConfigId: config.id,
				});
			terminal = session.terminalId;
			selected = {
				provider,
				agentConfigId: config.id,
				terminalId: session.terminalId ?? undefined,
				nativeSessionId: session.nativeSessionId ?? undefined,
			};
		} else {
			const session = await original.client.agents.run.mutate({
				workspaceId: id,
				agent: config.id,
				prompt: "",
				surface: "terminal",
			});
			if (session.chatSessionId)
				throw new Error(t({ message: "Agent did not start a terminal" }));
			terminal = session.sessionId;
		}
		const result = await original.client.terminal.list.query({
			workspaceId: id,
		});
		queryClient.setQueryData(
			["jedv", original.hostUrl, "terminals", id],
			result,
		);
		const live = result.sessions.find((row) => row.terminalId === terminal);
		if (live)
			attachTerminalSession(
				terminalWorkspaceStore(`${original.hostUrl}:${id}`),
				live,
			);
		if (
			request !== navigationSequence.current ||
			currentHost.current.client !== original.client ||
			currentHost.current.hostUrl !== original.hostUrl
		)
			return;
		setWorkspaceId(id);
		setSurface("terminal");
		setLaunched(selected);
		selectTerminal(terminal);
	};
	const launchAgent = async (provider: NativeProvider, id = workspaceId) => {
		const config = configuredAgents.find((item) => item.presetId === provider);
		if (!config)
			throw new Error(t({ message: "Agent configuration unavailable" }));
		await launchConfiguredAgent(config, id);
	};

	const openCheckout = async (projectId: string) => {
		if (!client) return;
		const existing = workspaces.data?.find(
			(item) => item.projectId === projectId && item.type === "local",
		);
		if (existing) await openWorkspace(existing.id);
		else {
			const result = await client.workspaces.create.mutate({
				projectId,
				checkout: "local",
			});
			await refresh();
			await openWorkspace(result.workspace.id);
		}
	};
	const browse = () => projectAction("open");
	const refreshProjectContext = async (context: ProjectActionContext) => {
		const [nextProjects, nextWorkspaces] = await Promise.all([
			context.client.project.list.query(),
			context.client.workspace.list.query(),
		]);
		queryClient.setQueryData(
			["jedv", context.hostUrl, "projects"],
			nextProjects,
		);
		queryClient.setQueryData(
			["jedv", context.hostUrl, "workspaces"],
			nextWorkspaces,
		);
	};

	const switchLocal = async () => {
		if (!remote) return;
		if (filesDirtyRef.current)
			throw new Error(
				t({
					message: "Save or close the unsaved files before switching hosts",
				}),
			);
		setFileTarget(null);
		if (remote) {
			knownConnections.current.delete(hostBaseUrl(remote));
			await disconnect.mutateAsync({ baseUrl: hostBaseUrl(remote) });
		}
		setRemote(null);
		setWorkspaceId(navigation.workspaceId);
		selectTerminal(navigation.terminalId);
		setError(null);
	};
	const restartLocal = () =>
		void run(async () => {
			await restart.mutateAsync({ organizationId: LOCAL_HOST_NAMESPACE });
			await connection.refetch();
		});
	const copyValue = (value: string) =>
		void run(async () => {
			await copy.mutateAsync(value);
			toast.success(t({ message: "Copied to clipboard" }));
		});
	const openFolder = (path: string) =>
		void run(async () => {
			await finder.mutateAsync(path);
		});
	const requestClose = (id: string, isCurrent: () => boolean = () => true) => {
		if (!client || !workspaceId || !hostUrl) return;
		if (!isCurrent()) return;
		const expected = { client, hostUrl, workspaceId };
		void run(async () => {
			const execute = async () => {
				if (!isCurrent()) return;
				await expected.client.terminal.killSession.mutate({
					workspaceId: expected.workspaceId,
					terminalId: id,
				});
				const result = await expected.client.terminal.list.query({
					workspaceId: expected.workspaceId,
				});
				queryClient.setQueryData(
					["jedv", expected.hostUrl, "terminals", expected.workspaceId],
					result,
				);
			};
			const { running } =
				await expected.client.terminal.hasRunningProcess.query({
					workspaceId: expected.workspaceId,
					terminalId: id,
				});
			if (!isCurrent()) return;
			if (!running || useTerminalCloseConfirmStore.getState().suppressed) {
				await execute();
				return;
			}
			setConfirmation({
				title: t({ message: "Kill Terminal Session" }),
				description: t({
					message:
						"This stops the shell and all processes running in this terminal. Workspace files are kept. Unsaved process state may be lost.",
				}),
				detail:
					terminals.data?.sessions.find((session) => session.terminalId === id)
						?.title ?? id,
				execute,
			});
		});
	};

	const projectHasDirtyFiles = (
		context: ProjectActionContext,
		projectId: string,
	) => {
		const file = fileTargetRef.current;
		if (!filesDirtyRef.current || file?.hostUrl !== context.hostUrl)
			return false;
		const rows = queryClient.getQueryData<Workspace[]>([
			"jedv",
			context.hostUrl,
			"workspaces",
		]);
		return (
			rows?.some(
				(row) => row.id === file.workspaceId && row.projectId === projectId,
			) ?? true
		);
	};

	useJedvHotkeys(
		(action) => {
			if (busy) return;
			if (action === "b")
				setNavigation((value) => ({
					...value,
					sidebarCollapsed: !value.sidebarCollapsed,
				}));
			else if (action === "quick-open") setPalette("files");
			else if (action === "commands") setPalette("commands");
			else if (action === "active-workspaces") setActiveSwitcherOpen(true);
			else if (action === "changes") showChanges();
			else if (action === "open-in-app") void run(openWorkspaceInEditor);
			else if (action === "resources") setResourcesOpen(true);
			else if (action === "right-fullscreen") {
				areas.state.setState({ rightAreaOpen: true, focusedArea: "right" });
				setMaximizedStore((value) =>
					value === rightStore ? null : rightStore,
				);
			} else if (action === "copy-workspace-path" && workspace?.worktreePath)
				void run(async () => {
					await navigator.clipboard.writeText(workspace.worktreePath ?? "");
					toast.success(t({ message: "Path copied" }));
				});
			else if (action === "split-right" || action === "split-down")
				void run(async () => {
					setSurface("terminal");
					await terminalLayoutRef.current?.split(
						action === "split-right" ? "right" : "bottom",
					);
				});
			else if (action.startsWith("preset-")) {
				const preset = matchingPresets.filter(
					(item) => item.pinnedToBar !== false,
				)[Number(action.slice(7)) - 1];
				if (preset) void run(() => runPreset(preset));
			} else if (action === "run-workspace")
				void run(async () => {
					await runActionRef.current?.();
				});
			else if (action === "history-back" || action === "history-forward")
				void run(() => moveHistory(action === "history-back" ? -1 : 1));
			else if (action === "o") browse();
			else if (action === "n" && projects.data?.length)
				setCreatingProjectId(project?.id ?? null);
			else if (action === "t") void run(() => createTerminal());
			else if (action === "w") terminalLayoutRef.current?.closeView();
			else if (action === "find-terminal") terminalLayoutRef.current?.find();
			else if (action === "clear-terminal") terminalLayoutRef.current?.clear();
			else if (action === "scroll-bottom")
				terminalLayoutRef.current?.scrollToBottom();
			else if (action === "split-auto")
				void run(async () => {
					await terminalLayoutRef.current?.split("auto");
				});
			else if (action === "equalize") terminalLayoutRef.current?.equalize();
			else if (action === "reopen-tab") terminalLayoutRef.current?.reopen();
			else if (action === "prev-tab" || action === "next-tab")
				terminalLayoutRef.current?.cycleTab(action === "prev-tab" ? -1 : 1);
			else if (action.startsWith("focus-"))
				terminalLayoutRef.current?.focus(
					action.slice(6) as "left" | "right" | "up" | "down",
				);
			else if (action.startsWith("zoom-"))
				void run(() => zoom(action.slice(5) as "in" | "out" | "reset"));
			else if (action === ".") {
				setSurface("terminal");
				areas.state.setState({
					rightAreaOpen: !areaState.rightAreaOpen,
					focusedArea: "left",
				});
			} else if (action === "settings") navigate("settings");
			else if (action === "back" && surface === "settings")
				setSurface(priorSurface.current);
			else if (action === "host") setConnecting(true);
			else if (action === "undo") {
				const target = recentlyDeleted.current.at(-1);
				if (target) setRestoreTarget(target);
			} else if (action === "close-workspace" && projectContext && workspace)
				setDeleteTarget({ context: projectContext, workspace });
			else if (action.startsWith("workspace-")) {
				const id = shortcutWorkspaceIds.current[Number(action.slice(10)) - 1];
				if (id) void run(() => openWorkspace(id));
			} else if (action.startsWith("tab-"))
				terminalLayoutRef.current?.selectTab(Number(action.slice(4)) - 1);
		},
		{
			canGoBack: surface === "settings",
			terminalActive: surface === "terminal",
		},
	);
	const rawFailure =
		error ??
		navigationStatus.error?.message ??
		layoutPersistence.error?.message ??
		readReceiptSync.error?.message ??
		connection.error?.message ??
		projects.error?.message ??
		workspaces.error?.message ??
		health.error?.message;
	const failure = rawFailure === dismissedFailure ? null : rawFailure;
	const viewContext: JedvParityViewContext | null =
		client && hostUrl
			? {
					client,
					hostUrl,
					logicalHostId,
					remote,
					projects: projects.data ?? [],
					workspaces: workspaces.data ?? [],
					onOpenWorkspace: openWorkspace,
					onOpenCreateWorkspace: (projectId) =>
						setCreatingProjectId(projectId ?? null),
					onOpenPrivateConnection: () => setConnecting(true),
					onSelectLocalHost: switchLocal,
				}
			: null;
	const openFiles = (path?: string, pinned = false) => {
		if (!workspaceId || !hostUrl) return;
		if (
			filesDirtyRef.current &&
			fileTarget &&
			(fileTarget.hostUrl !== hostUrl || fileTarget.workspaceId !== workspaceId)
		) {
			setSurface("files");
			toast.error(
				t({
					message:
						"Save or close the unsaved files before opening another workspace",
				}),
			);
			return;
		}
		if (path) rememberPaletteFile(hostUrl, workspaceId, path);
		setFileTarget({ hostUrl, workspaceId, path, pinned });
		openFilesTab(focusedStore);
		setSurface("terminal");
	};

	const showWelcome =
		welcomeReplay ||
		(onboarding.data?.completed === false &&
			projects.isSuccess &&
			projects.data.length === 0 &&
			!remote);
	const leftSessionMenu = useTerminalSessionsMenu({
		store: terminalStore,
		sessions: terminals.data?.sessions ?? [],
		activeId: paneTerminalId(terminalStore.getState().getActivePane()?.pane),
		enabled: !!workspace && connected && !busy && layoutPersistence.ready,
		connected: terminalConnected,
		sessionPicker:
			client && hostUrl && workspaceId
				? { client, hostUrl, workspaceId, onSelectSession: selectExistingAgent }
				: undefined,
		configs: configuredAgents,
		onNew: () => void run(() => createTerminal(workspaceId, terminalStore)),
		onAttach: (id) => {
			selectTerminal(id);
			setSurface("terminal");
		},
		onKill: requestClose,
		onLaunch: (config) => void run(() => launchConfiguredAgent(config)),
		onSettings: () => navigate("settings"),
	});

	const rightSessionMenu = useTerminalSessionsMenu({
		store: rightStore,
		sessions: terminals.data?.sessions ?? [],
		activeId: paneTerminalId(rightStore.getState().getActivePane()?.pane),
		enabled: !!workspace && connected && !busy && layoutPersistence.ready,
		connected: terminalConnected,
		sessionPicker:
			client && hostUrl && workspaceId
				? { client, hostUrl, workspaceId, onSelectSession: selectExistingAgent }
				: undefined,
		configs: configuredAgents,
		onNew: () => void run(() => createTerminal(workspaceId, rightStore)),
		onAttach: (id) => {
			selectTerminal(id);
			setSurface("terminal");
		},
		onKill: requestClose,
		onLaunch: (config) => void run(() => launchConfiguredAgent(config)),
		onSettings: () => navigate("settings"),
	});

	const empty = (
		<JedvEmptyState
			workspace={!!workspace}
			gitEnabled={supportsGit(workspace)}
			projects={projects.data ?? []}
			disabled={busy || !connected}
			onProjectAction={projectAction}
			onNewWorkspace={() => setCreatingProjectId(project?.id ?? null)}
			onConnect={() => setConnecting(true)}
			onOpenProject={(id) => void run(() => openCheckout(id))}
			onTerminal={() => void run(() => createTerminal())}
			onFiles={() => openFiles()}
			onChanges={() => showChanges()}
			onSearchFiles={() => setPalette("files")}
		/>
	);
	const toolbarContent = (
		<>
			{client && hostUrl && workspaceId && project && (
				<JedvProjectRun
					onForwardPorts={
						remote ? () => forwardsOpenRef.current?.() : undefined
					}
					worktreePath={workspace?.worktreePath}
					remote={!!remote}
					getWsToken={() => activeConnection?.secret ?? null}
					key={`${hostUrl}:${project.id}:${workspaceId}`}
					client={client}
					hostUrl={hostUrl}
					workspaceId={workspaceId}
					projectId={project.id}
					runRef={runActionRef}
					title={`${project.name} / ${workspace?.name || workspace?.branch || ""}`}
					anchorRef={workspaceActionsRef}
					onOpenFiles={() => openFiles()}
					onOpenAgent={() => setDrawer(true)}
					pendingApprovals={nativeState?.pendingApprovals.length ?? 0}
					onConfigure={() => {
						const context = { client, hostUrl, workspaceId };
						if (
							isCurrentTerminalContext(currentTerminalContext.current, context)
						)
							setScriptTarget(
								(previous) =>
									previous ?? {
										context,
										projectId: project.id,
									},
							);
					}}
					onTerminal={(id) =>
						openCompletedTerminal({ client, hostUrl, workspaceId }, id)
					}
				/>
			)}
			<RightSidebarToggle
				isOpen={areaState.rightAreaOpen}
				onToggle={() =>
					areas.state.setState({
						rightAreaOpen: !areaState.rightAreaOpen,
						focusedArea: "left",
					})
				}
			/>
			{workspace && (
				<Popover open={drawer} onOpenChange={setDrawer}>
					<PopoverAnchor virtualRef={workspaceActionsAnchor} />
					<PopoverContent
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							workspaceActionsRef.current?.focus();
						}}
						align="end"
						className="w-[328px] max-h-[min(600px,80vh)] overflow-y-auto p-0"
					>
						<div id="jedv-control-anchor" />
					</PopoverContent>
				</Popover>
			)}
		</>
	);

	const notification = failure && (
		<div
			role="alert"
			className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs"
		>
			<span className="min-w-0 flex-1 break-words">{failure}</span>
			<Button
				size="sm"
				variant="ghost"
				onClick={() =>
					void run(async () => {
						setError(null);
						await Promise.all([
							refresh(),
							health.refetch(),
							layoutPersistence.retry(),
							readReceiptSync.retry(),
						]);
					})
				}
			>
				<Trans>Retry</Trans>
			</Button>
			{remote ? (
				<Button size="sm" variant="ghost" onClick={() => void run(switchLocal)}>
					<Trans>Switch to Local</Trans>
				</Button>
			) : (
				<Button size="sm" variant="ghost" onClick={restartLocal}>
					<Trans>Restart Local Host</Trans>
				</Button>
			)}
			<button
				type="button"
				aria-label={t({ message: "Dismiss" })}
				onClick={() => {
					setError(null);
					setDismissedFailure(rawFailure ?? null);
				}}
			>
				<LuX className="size-3.5" />
			</button>
		</div>
	);
	return (
		<WindowChromeContext
			value={{
				...chrome,
				notification,
				surface,
				collapsed: navigation.sidebarCollapsed && surface !== "settings",
				onExpand: () =>
					setNavigation((value) => ({ ...value, sidebarCollapsed: false })),
			}}
		>
			<main className="jedv-shell">
				{showWelcome && (
					<div className="absolute inset-0 z-30">
						<JedvWelcome
							context={projectContext}
							onComplete={finishWelcome}
							onOpenProject={projectAction}
							onImported={async ({ context, workspaceIds }) => {
								await refreshProjectContext(context);
								if (
									currentHost.current.client === context.client &&
									currentHost.current.hostUrl === context.hostUrl &&
									workspaceIds[0]
								)
									await openWorkspace(workspaceIds[0]);
							}}
						/>
					</div>
				)}
				<ResizablePanelGroup direction="horizontal">
					{!navigation.sidebarCollapsed && surface !== "settings" && (
						<>
							<ResizablePanel defaultSize={21} minSize={15} maxSize={35}>
								<aside className="flex h-full min-h-0 overflow-hidden select-none flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
									<JedvSidebarHeader
										host={
											remote
												? new URL(hostBaseUrl(remote)).host
												: t({ message: "This device" }) +
													" · " +
													t({ message: "Local" })
										}
										connected={connected}
										canGoBack={history.current.index > 0}
										canGoForward={
											history.current.index < history.current.entries.length - 1
										}
										onBack={() => void run(() => moveHistory(-1))}
										onForward={() => void run(() => moveHistory(1))}
										collapsed={false}
										height={48}
										onToggle={() =>
											setNavigation((value) => ({
												...value,
												sidebarCollapsed: true,
											}))
										}
										onLocal={() => void run(switchLocal)}
										onConnect={() => setConnecting(true)}
										onRestart={restartLocal}
										onProjectAction={projectAction}
									/>

									<JedvSidebarNav
										footerHost={
											<JedvHostMenu
												host={
													remote
														? new URL(hostBaseUrl(remote)).host
														: t({ message: "This device" }) +
															" · " +
															t({ message: "Local" })
												}
												connected={connected}
												onLocal={() => void run(switchLocal)}
												onConnect={() => setConnecting(true)}
												onRestart={restartLocal}
												onProjectAction={projectAction}
											/>
										}
										onNewWorkspace={() =>
											setCreatingProjectId(project?.id ?? null)
										}
										canCreateWorkspace={
											!!projectContext && !busy && !!projects.data?.length
										}
										surface={surface}
										usageVisible={usageVisible.data ?? false}
										onSelect={navigate}
										onSearch={() => setPalette("commands")}
									>
										<ButlerNavigation
											active={surface === "butler"}
											count={butler.actionable}
											onSelect={() => navigate("butler")}
										/>
										<div className="min-h-0 flex-1 overflow-y-auto">
											<TeamworkDirectory
												index={teamwork}
												selectedId={selectedTeamId}
												active={surface === "teamwork"}
												onSelect={openTeam}
											/>
											<SidebarSectionHeading
												label={<Trans>Projects</Trans>}
												collapsed={projectsCollapsed}
												onToggle={() => {
													setProjectsCollapsed((value) => !value);
													setFilter("");
													setFilterOpen(false);
												}}
											>
												<button
													type="button"
													ref={filterButton}
													aria-label={t({ message: "Search projects" })}
													className="grid size-6 place-items-center rounded hover:bg-fill-hover"
													onClick={() => {
														setProjectsCollapsed(false);
														setFilterOpen((value) => !value);
														if (filterOpen) setFilter("");
													}}
												>
													<LuSearch className="size-3.5" />
												</button>
												<ProjectSortMenu
													value={navigation.workspaceSortMode ?? "manual"}
													disabled={busy}
													onChange={(workspaceSortMode) =>
														setNavigation((value) => ({
															...value,
															workspaceSortMode,
														}))
													}
												/>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<button
															type="button"
															aria-label={t({ message: "Add project" })}
															className="group grid size-6 place-items-center rounded hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
														>
															<VscNewFolder className="size-3.5 group-hover:hidden" />
															<VscFolderOpened className="hidden size-3.5 group-hover:block" />
														</button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<JedvProjectMenuItems
															disabled={!projectContext}
															onAction={projectAction}
															openShortcut={openProjectShortcut}
														/>
													</DropdownMenuContent>
												</DropdownMenu>
											</SidebarSectionHeading>
											{filterOpen && (
												<Input
													autoFocus
													aria-label={t({ message: "Search projects" })}
													className="mx-3 mb-2 h-6 w-auto text-xs"
													value={filter}
													onChange={(event) => setFilter(event.target.value)}
													onKeyDown={(event) => {
														if (event.key === "Escape") {
															setFilter("");
															setFilterOpen(false);
															filterButton.current?.focus();
														}
													}}
												/>
											)}
											<div
												hidden={projectsCollapsed}
												className="space-y-1 py-1"
											>
												{projectContext && (
													<JedvProjectTree
														onOpenPullRequest={(context, target) => {
															if (
																currentHost.current.hostUrl !== context.hostUrl
															)
																return;
															setActivityPullRequest({
																hostUrl: context.hostUrl,
																target,
															});
															navigate("pull-requests");
														}}
														onOpenPort={async (context, _id, url) => {
															if (
																currentHost.current.hostUrl === context.hostUrl
															)
																await electronTrpcClient.external.openUrl.mutate(
																	url,
																);
														}}
														key={hostUrl}
														onShortcutOrder={recordShortcutOrder}
														context={projectContext}
														projects={projects.data ?? []}
														workspaces={workspaces.data ?? []}
														bindings={bindings.data ?? []}
														agentSessions={agentSessions}
														workspaceTeams={teamwork.workspaceTeams}
														onOpenTeam={openTeam}
														activeWorkspaceId={workspaceId}
														filter={filter}
														disabled={busy}
														navigation={{
															collapsedGroups: navigation.collapsedGroups,
															setCollapsedGroups: (keys) =>
																setNavigation((value) => ({
																	...value,
																	collapsedGroups: keys.slice(-128),
																})),
															collapsedProjects: navigation.collapsedProjects,
															workspaceSortMode: navigation.workspaceSortMode,
															setCollapsedProjects: (ids) =>
																setNavigation((value) => ({
																	...value,
																	collapsedProjects: ids.slice(-64),
																})),
															setWorkspaceSortMode: (mode) =>
																setNavigation((value) => ({
																	...value,
																	workspaceSortMode: mode,
																})),
														}}
														onOpenWorkspace={async (
															context,
															id,
															selectedTerminal,
														) => {
															if (
																currentHost.current.client === context.client &&
																currentHost.current.hostUrl === context.hostUrl
															)
																await openWorkspace(id, selectedTerminal);
														}}
														onCreateTerminal={async (context, id) => {
															if (
																currentHost.current.client === context.client &&
																currentHost.current.hostUrl === context.hostUrl
															)
																await createTerminal(id);
														}}
														onLaunch={async (context, provider, id) => {
															if (
																currentHost.current.client === context.client &&
																currentHost.current.hostUrl === context.hostUrl
															)
																await launchAgent(provider, id);
														}}
														onRename={async (context, target, name) => {
															if (target.kind === "project")
																await context.client.project.update.mutate({
																	projectId: target.id,
																	name,
																});
															else
																await context.client.workspace.update.mutate({
																	id: target.id,
																	name,
																});
															await refreshProjectContext(context);
														}}
														onDeleteWorkspace={(context, workspace) =>
															setDeleteTarget({ context, workspace })
														}
														onCopy={(_context, value) => copyValue(value)}
														onOpenFolder={(context, path) => {
															if (!context.isRemote) openFolder(path);
														}}
														onProjectAction={(context, item, mode) =>
															setWorkspaceCreation({
																context,
																projects: projects.data ?? [],
																projectId: item.id,
																mode,
															})
														}
														onAppearance={(context, project) =>
															setAppearanceTarget({ context, project })
														}
														onRemoveProject={(context, project) =>
															setRemovalTarget({ context, project })
														}
														onProjectSettings={(context, project) =>
															setProjectSettingsTarget({ context, project })
														}
														onChanged={refreshProjectContext}
													/>
												)}
											</div>
											{viewContext && (
												<DeclarativeDataSlots
													context={viewContext}
													surface="sidebar.panel"
													teamId={
														surface === "teamwork"
															? (selectedTeamId ?? undefined)
															: undefined
													}
													connected={connected}
												/>
											)}
										</div>
										<div className="shrink-0 px-3">
											<JedvReleaseNotes automatic />
											<UpdatesPill variant="sidebar" />
										</div>
									</JedvSidebarNav>
								</aside>
							</ResizablePanel>
							<ResizableHandle />
						</>
					)}
					<ResizablePanel defaultSize={79} minSize={40}>
						<section
							ref={setWorkspaceElement}
							className="flex h-full min-w-0 flex-col bg-background"
						>
							{!viewContext &&
								surface !== "terminal" &&
								surface !== "files" && (
									<WindowChrome primary>
										<WindowChromeLeading
											leftmost={
												surface === "settings" || navigation.sidebarCollapsed
											}
											expand={
												navigation.sidebarCollapsed && surface !== "settings"
											}
										/>
										<div className="drag min-w-4 flex-1" />
										<WindowControlsInset />
									</WindowChrome>
								)}
							{!viewContext &&
								(surface === "teamwork" ||
									surface === "create-team" ||
									surface === "butler") && (
									<div
										role="alert"
										className="m-5 flex items-center gap-2 rounded border border-destructive/30 p-3 text-xs text-destructive"
									>
										<span className="flex-1">
											<Trans>
												Host offline. Team actions are unavailable until the
												connection is restored.
											</Trans>
										</span>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => void connection.refetch()}
										>
											<Trans>Retry</Trans>
										</Button>
									</div>
								)}
							{viewContext && surface === "butler" && (
								<ContentBoundary key={`${viewContext.hostUrl}:butler`}>
									<ButlerView
										key={viewContext.hostUrl}
										context={viewContext}
										index={butler}
										teams={teamwork.list.data ?? []}
										connected={connected}
										onSettings={() => {
											setSettingsSection("system-agents");
											navigate("settings");
										}}
										onOpenTeam={openTeam}
										onOpenAutomations={() => navigate("automations")}
									/>
								</ContentBoundary>
							)}
							{viewContext && surface === "board" && (
								<JedvWorkspacesBoard
									{...viewContext}
									getHasUnsavedFiles={(context, id) =>
										filesDirtyRef.current &&
										fileTargetRef.current?.hostUrl === context.hostUrl &&
										fileTargetRef.current?.workspaceId === id
									}
									onWorkspaceDeleted={async ({
										context,
										workspaceId: id,
										warnings,
									}) => {
										if (
											currentHost.current.hostUrl === context.hostUrl &&
											currentHost.current.client === context.client &&
											currentTerminalContext.current?.workspaceId === id
										) {
											setWorkspaceId(null);
											selectTerminal(null);
										}
										if (
											fileTargetRef.current?.hostUrl === context.hostUrl &&
											fileTargetRef.current?.workspaceId === id
										)
											setFileTarget(null);
										for (const warning of warnings) toast.warning(warning);
									}}
									onOpenWorkspaceInContext={async ({
										context,
										workspaceId: id,
									}) => {
										if (
											currentHost.current.hostUrl === context.hostUrl &&
											currentHost.current.client === context.client
										)
											await openWorkspace(id);
									}}
								/>
							)}
							{viewContext && surface === "create-team" && (
								<ContentBoundary>
									<CreateTeamView
										initialWorkspaceId={workspaceId}
										key={viewContext.hostUrl}
										context={viewContext}
										index={teamwork}
										connected={connected}
										onCreated={(id) => {
											if (
												currentHost.current.client === viewContext.client &&
												currentHost.current.hostUrl === viewContext.hostUrl
											)
												openTeam(id);
										}}
									/>
								</ContentBoundary>
							)}
							{viewContext && surface === "teamwork" && (
								<ContentBoundary>
									<JedvTeamworkView
										key={viewContext.hostUrl}
										context={viewContext}
										index={teamwork}
										connected={connected}
										selectedId={selectedTeamId}
										onCreate={() => navigate("create-team")}
									/>
								</ContentBoundary>
							)}
							{viewContext && surface === "automations" && (
								<JedvAutomationsView {...viewContext} />
							)}
							{viewContext && surface === "pull-requests" && (
								<JedvPullRequestsView
									{...viewContext}
									initialTarget={
										activityPullRequest?.hostUrl === hostUrl
											? activityPullRequest.target
											: undefined
									}
								/>
							)}
							{viewContext && surface === "usage" && (
								<JedvUsageView {...viewContext} />
							)}
							{viewContext && surface === "settings" && (
								<JedvSettingsView
									{...viewContext}
									initialSection={settingsSection}
									onBack={() => setSurface(priorSurface.current)}
								/>
							)}
							{viewContext &&
								fileTarget &&
								fileTarget.hostUrl === hostUrl &&
								createPortal(
									<div className="flex min-h-0 flex-1">
										<JedvFilesView
											key={`${fileTarget.hostUrl}:${fileTarget.workspaceId}`}
											context={viewContext}
											workspaceId={fileTarget.workspaceId}
											initialPath={fileTarget.path}
											initialPinned={fileTarget.pinned}
											initialRequestId={fileTarget.requestId}
											getWsToken={() => activeConnection?.secret ?? null}
											active={
												(surface === "terminal" || surface === "files") &&
												filesSurfaceMatches(
													fileTarget,
													hostUrl ?? "",
													workspaceId ?? "",
												) &&
												(areaState.focusedArea === "right"
													? areaState.rightAreaOpen &&
														rightTabs.some(
															(tab) =>
																tab.id === rightActiveTabId &&
																tab.panes[tab.activePaneId ?? ""]?.kind ===
																	"files",
														)
													: terminalTabs.some(
															(tab) =>
																tab.id === activeTabId &&
																tab.panes[tab.activePaneId ?? ""]?.kind ===
																	"files",
														))
											}
											onDirtyChange={setFilesDirty}
											onOpenUrl={(url) => openConfiguredUrl(url)}
										/>
									</div>,
									filesHost,
								)}
							<div
								id="jedv-files-parking"
								hidden
								ref={(node) => {
									if (node && !filesHost.parentElement)
										node.appendChild(filesHost);
								}}
							/>
							<div
								hidden={surface !== "terminal" && surface !== "files"}
								className="flex min-h-0 min-w-0 flex-1"
							>
								<ResizablePanelGroup direction="horizontal">
									<ResizablePanel
										ref={leftPanelRef}
										defaultSize={areaState.rightAreaOpen ? 60 : 100}
										minSize={25}
										collapsible
										collapsedSize={0}
									>
										<div
											className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
											inert={rightMaximized}
										>
											<div
												hidden={surface !== "terminal" && surface !== "files"}
											>
												<JedvTerminalTabStrip
													editorContext={viewContext ?? undefined}
													enabled={
														!!workspace &&
														connected &&
														!busy &&
														layoutPersistence.ready
													}
													connected={terminalConnected}
													store={terminalStore}
													sessions={terminals.data?.sessions ?? []}
													onTabBarMount={setTabBarMount}
													onAttach={(id) => {
														selectTerminal(id);
														setSurface("terminal");
													}}
													onKill={requestClose}
													showPresetsBar={showPresetsBar.data ?? true}
													presets={matchingPresets}
													onRunPreset={(preset) =>
														void run(() => runPreset(preset))
													}
													sessionPicker={
														client && hostUrl && workspaceId
															? {
																	client,
																	hostUrl,
																	workspaceId,
																	onSelectSession: selectExistingAgent,
																}
															: undefined
													}
													agentConfigs={configuredAgents}
													onSettings={() => {
														setSettingsSection("terminal");
														navigate("settings");
													}}
													onLaunch={(config) =>
														void run(() => launchConfiguredAgent(config))
													}
													changes={
														client && hostUrl && workspaceId ? (
															<JedvWorkspaceActivity
																gitEnabled={supportsGit(workspace)}
																pullRequestsEnabled={supportsPullRequests(
																	workspace,
																)}
																shipContext={viewContext ?? undefined}
																onOpenFile={openFiles}
																getHasUnsavedFiles={() => filesDirtyRef.current}
																dockTarget={activityDockTarget}
																dockFits={activityFits}
																dockHidden={areaState.activityDockHidden}
																onDockHiddenChange={(activityDockHidden) =>
																	areas.state.setState({ activityDockHidden })
																}
																isChangesOpen={changesOpen}
																key={`${hostUrl}:${workspaceId}`}
																client={client}
																hostUrl={hostUrl}
																workspaceId={workspaceId}
																onOpenChanges={() => {
																	showChanges(true);
																}}
																workspaceName={
																	workspace?.name ?? workspace?.branch ?? ""
																}
																getWsToken={() =>
																	activeConnection?.secret ?? null
																}
																attachedTerminalIds={[
																	...terminalTabs,
																	...rightTabs,
																].flatMap((tab) =>
																	Object.values(tab.panes)
																		.filter(isTerminalPane)
																		.map((pane) => pane.data.terminalId),
																)}
																agentSource={island.agentSource}
																onOpenTerminal={async (id) => {
																	selectTerminal(id);
																	setSurface("terminal");
																}}
																onOpenAgent={(entry) =>
																	island.focusEntry(entry.entryId)
																}
																onOpenPullRequests={(pr) => {
																	setActivityPullRequest(
																		pr
																			? {
																					hostUrl,
																					target: {
																						projectId: project?.id ?? "",
																						owner: pr.repoOwner,
																						repo: pr.repoName,
																						number: pr.number,
																						title: pr.title,
																					},
																				}
																			: null,
																	);
																	navigate("pull-requests");
																}}
															/>
														) : null
													}
													ports={
														client &&
														hostUrl &&
														workspaceId && (
															<WorkspaceForwards
																openRef={forwardsOpenRef}
																anchorRef={workspaceActionsRef}
																onOpenUrl={(url) =>
																	openConfiguredUrl(url, true)
																}
																client={client}
																remote={!!remote}
																getWsToken={() =>
																	activeConnection?.secret ?? null
																}
																hostUrl={hostUrl}
																workspaceId={workspaceId}
															/>
														)
													}
													showWindowControls={!areaState.rightAreaOpen}
													tools={
														!areaState.rightAreaOpen ? (
															<WorkspaceToolbarSlot host={toolbarHost} />
														) : null
													}
												/>
											</div>
											<ActivityPanelAside
												top={(showPresetsBar.data ?? true) ? 84 : 48}
												hidden={!activityFits || areaState.activityDockHidden}
												onTarget={setActivityDockTarget}
												onFits={setActivityFits}
											/>
											{!drawer &&
												nativeState?.activeWriter === "control" &&
												nativeState.pendingApprovals.length > 0 && (
													<div className="flex h-8 shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 text-xs">
														<span className="flex-1">
															<Trans>Approval required</Trans>
														</span>
														{(["accept", "decline"] as const).map(
															(decision) => (
																<Button
																	key={decision}
																	size="sm"
																	variant="ghost"
																	onClick={() =>
																		void run(async () => {
																			if (
																				!client ||
																				!nativeState.nativeSessionId ||
																				!workspaceId
																			)
																				return;
																			await client.terminalAgents.controlNativeSession.mutate(
																				{
																					workspaceId,
																					provider: nativeState.provider,
																					nativeSessionId:
																						nativeState.nativeSessionId,
																					expectedLeaseEpoch:
																						nativeState.leaseEpoch,
																					action: {
																						type: "approve",
																						requestId:
																							nativeState.pendingApprovals[0]
																								.requestId,
																						decision,
																					},
																				},
																			);
																		})
																	}
																>
																	{decision === "accept" ? (
																		<Trans>Accept</Trans>
																	) : (
																		<Trans>Decline</Trans>
																	)}
																</Button>
															),
														)}
														<Button
															size="sm"
															variant="ghost"
															onClick={() => setDrawer(true)}
														>
															<Trans>Details</Trans>
														</Button>
													</div>
												)}
											{workspace &&
											workspaceId &&
											client &&
											activeConnection &&
											hostUrl &&
											layoutPersistence.ready ? (
												<JedvTerminalWorkspace
													sessionsMenu={leftSessionMenu.menu}
													sessionMenuProps={leftSessionMenu.props}
													area="left"
													contentInsetRight={
														activityFits && !areaState.activityDockHidden
															? 340
															: undefined
													}
													filesHost={
														hostUrl &&
														workspaceId &&
														filesSurfaceMatches(
															fileTarget,
															hostUrl,
															workspaceId,
														)
															? filesHost
															: null
													}
													otherArea={rightStore}
													focused={
														!(
															areaState.rightAreaOpen &&
															areaState.focusedArea === "right"
														)
													}
													onAreaFocus={() =>
														areas.state.setState({ focusedArea: "left" })
													}
													key={`${hostUrl}:${workspaceId}`}
													connection={activeConnection}
													hostUrl={hostUrl}
													onOpenUrl={(url) => openConfiguredUrl(url)}
													workspaceId={workspaceId}
													activeId={terminalId}
													store={terminalStore}
													active={surface === "terminal"}
													tabBarMount={tabBarMount}
													emptyState={empty}
													onNew={() =>
														void run(() =>
															createTerminal(workspaceId, terminalStore),
														)
													}
													agentConfigs={configuredAgents}
													agentByTerminal={agentByTerminal}
													agentSessionNames={agentSessionNames}
													agentProjectionReady={bindings.data !== undefined}
													agentBindings={currentBindings}
													agentSessionByTerminal={
														new Map(
															currentBindings
																.filter(
																	(binding) =>
																		typeof binding.agentSessionId === "string",
																)
																.map((binding) => [
																	binding.terminalId,
																	binding.agentSessionId ?? "",
																]),
														)
													}
													onLaunch={(config) =>
														void run(() => launchConfiguredAgent(config))
													}
													sessions={terminals.data?.sessions}
													onCreated={async () => {
														await refreshTerminals(workspaceId);
													}}
													onConnectionChange={setTerminalConnected}
													client={client}
													onSelect={selectTerminal}
													onKill={requestClose}
													onOpenFile={openFiles}
													getHasUnsavedFiles={() =>
														filesDirtyRef.current &&
														fileTargetRef.current?.hostUrl === hostUrl &&
														fileTargetRef.current?.workspaceId === workspaceId
													}
													actionsRef={leftLayoutRef}
													remote={!!remote}
												/>
											) : workspace && !layoutPersistence.ready ? (
												<div className="m-auto space-y-2 p-4 text-sm text-muted-foreground">
													<p>
														<Trans>Restoring workspace layout…</Trans>
													</p>
													{layoutPersistence.error && (
														<Button
															variant="outline"
															onClick={() => void layoutPersistence.retry()}
														>
															<Trans>Retry</Trans>
														</Button>
													)}
												</div>
											) : (
												empty
											)}
										</div>
									</ResizablePanel>
									<ResizableHandle
										className={areaState.rightAreaOpen ? "" : "hidden"}
									/>
									<ResizablePanel
										ref={setRightPanel}
										defaultSize={areaState.rightAreaOpen ? 40 : 0}
										minSize={Math.min(
											75,
											(262 / Math.max(workspaceWidth, 350)) * 100,
										)}
										collapsible
										collapsedSize={0}
										onCollapse={() =>
											areas.state.setState({
												rightAreaOpen: false,
												focusedArea: "left",
											})
										}
										onExpand={() =>
											areas.state.setState({ rightAreaOpen: true })
										}
									>
										<div
											className="flex h-full min-h-0 flex-col"
											inert={!areaState.rightAreaOpen}
											style={{
												visibility: areaState.rightAreaOpen
													? "visible"
													: "hidden",
											}}
										>
											<WindowChrome
												height={48}
												className="bg-muted/45 shadow-[inset_0_-1px_0_var(--border)] dark:bg-muted/35"
											>
												{rightMaximized && navigation.sidebarCollapsed && (
													<WindowChromeLeading leftmost expand />
												)}
												<div
													ref={setRightTabBarMount}
													className="no-drag flex min-w-0 flex-1 self-stretch"
												/>
												<div className="drag min-w-4" />
												<WindowChromeControls className="shrink-0 pr-2">
													<div className="flex items-center gap-1">
														<button
															type="button"
															aria-label={
																rightMaximized
																	? t({ message: "Restore pane area" })
																	: t({ message: "Expand pane area" })
															}
															aria-pressed={rightMaximized}
															className="grid size-7 shrink-0 place-items-center self-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
															onClick={() => {
																areas.state.setState({ focusedArea: "right" });
																setMaximizedStore((value) =>
																	value === rightStore ? null : rightStore,
																);
															}}
														>
															{rightMaximized ? (
																<LuMinimize2 className="size-4" />
															) : (
																<LuMaximize2 className="size-4" />
															)}
														</button>
														{areaState.rightAreaOpen && (
															<WorkspaceToolbarSlot host={toolbarHost} />
														)}
													</div>
												</WindowChromeControls>
												<WindowControlsInset />
											</WindowChrome>
											{client &&
											hostUrl &&
											workspaceId &&
											activeConnection &&
											layoutPersistence.ready ? (
												<JedvTerminalWorkspace
													sessionsMenu={rightSessionMenu.menu}
													sessionMenuProps={rightSessionMenu.props}
													area="right"
													filesHost={
														hostUrl &&
														workspaceId &&
														filesSurfaceMatches(
															fileTarget,
															hostUrl,
															workspaceId,
														)
															? filesHost
															: null
													}
													otherArea={terminalStore}
													focused={
														areaState.rightAreaOpen &&
														areaState.focusedArea === "right"
													}
													onAreaFocus={() =>
														areas.state.setState({ focusedArea: "right" })
													}
													key={`${hostUrl}:${workspaceId}`}
													connection={activeConnection}
													hostUrl={hostUrl}
													onOpenUrl={(url) => openConfiguredUrl(url)}
													workspaceId={workspaceId}
													activeId={terminalId}
													store={rightStore}
													active={
														(surface === "terminal" || surface === "files") &&
														areaState.rightAreaOpen
													}
													tabBarMount={rightTabBarMount}
													emptyState={empty}
													onNew={() =>
														void run(() =>
															createTerminal(workspaceId, rightStore),
														)
													}
													agentConfigs={configuredAgents}
													agentByTerminal={agentByTerminal}
													agentSessionNames={agentSessionNames}
													agentProjectionReady={bindings.data !== undefined}
													agentBindings={currentBindings}
													agentSessionByTerminal={
														new Map(
															currentBindings
																.filter(
																	(binding) =>
																		typeof binding.agentSessionId === "string",
																)
																.map((binding) => [
																	binding.terminalId,
																	binding.agentSessionId ?? "",
																]),
														)
													}
													onLaunch={(config) =>
														void run(() => launchConfiguredAgent(config))
													}
													sessions={terminals.data?.sessions}
													onCreated={async () => {
														await refreshTerminals(workspaceId);
													}}
													onConnectionChange={setTerminalConnected}
													client={client}
													onSelect={selectTerminal}
													onKill={requestClose}
													onOpenFile={openFiles}
													getHasUnsavedFiles={() =>
														filesDirtyRef.current &&
														fileTargetRef.current?.hostUrl === hostUrl &&
														fileTargetRef.current?.workspaceId === workspaceId
													}
													actionsRef={rightLayoutRef}
													remote={!!remote}
												/>
											) : (
												empty
											)}
										</div>
									</ResizablePanel>
								</ResizablePanelGroup>
								{client && hostUrl && workspaceId && (
									<aside hidden>
										<NativeAgentControls
											remote={!!remote}
											key={`${hostUrl}:${workspaceId}`}
											client={client}
											hostUrl={hostUrl}
											workspaceId={workspaceId}
											terminalId={terminalId}
											launched={launched}
											popoverOpen={drawer}
											onStateChange={(state) => {
												if (
													isCurrentTerminalContext(
														currentTerminalContext.current,
														{ client, hostUrl, workspaceId },
													)
												)
													setNativeState(state);
											}}
											onTerminal={(id) =>
												openCompletedTerminal(
													{ client, hostUrl, workspaceId },
													id,
												)
											}
										/>
									</aside>
								)}
							</div>
							<JedvResourceSummary
								client={client ?? undefined}
								remote={!!remote}
								workspaces={workspaces.data ?? []}
								open={resourcesOpen}
								onOpenChange={setResourcesOpen}
								showSummary={resourcesVisible.data ?? false}
								onOpenWorkspace={openWorkspace}
							/>
						</section>
					</ResizablePanel>
				</ResizablePanelGroup>

				{activeSwitcherOpen && projectContext && (
					<ActiveWorkspaceSwitcher
						key={hostUrl}
						context={projectContext}
						onClose={() => setActiveSwitcherOpen(false)}
						onOpen={async ({ context, workspaceId: id }) => {
							if (
								currentHost.current.client === context.client &&
								currentHost.current.hostUrl === context.hostUrl
							)
								await openWorkspace(id);
						}}
					/>
				)}
				<AgentSetupGuard
					blocker={launchGuard.blocker}
					checking={launchGuard.checking}
					onRefresh={launchGuard.refresh}
					onDismiss={launchGuard.dismiss}
					onOpenSetup={async (id, setupTerminalId) => {
						await openWorkspace(id, setupTerminalId);
						launchGuard.dismiss();
					}}
					onSettings={() => {
						launchGuard.dismiss();
						setSettingsSection("general");
						navigate("settings");
					}}
				/>
				<JedvProjectActions
					ref={projectActionsRef}
					context={projectContext}
					onRefresh={refreshProjectContext}
					onOpened={async ({ context, workspaceId: openedWorkspace }) => {
						if (
							currentHost.current.client !== context.client ||
							currentHost.current.hostUrl !== context.hostUrl
						)
							return;
						await openWorkspace(openedWorkspace);
						if (showWelcome) await finishWelcome();
					}}
				/>
				{projectSettingsTarget && (
					<Dialog
						open
						onOpenChange={(open) => {
							if (!open) setProjectSettingsTarget(null);
						}}
					>
						<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
							<DialogTitle>
								<Trans>Project settings</Trans>
							</DialogTitle>
							<DialogDescription>
								{projectSettingsTarget.project.name} ·{" "}
								{projectSettingsTarget.context.hostLabel}
							</DialogDescription>
							<ProjectSettings
								key={`${projectSettingsTarget.context.hostUrl}:${projectSettingsTarget.project.id}`}
								context={projectSettingsTarget.context}
								projectId={projectSettingsTarget.project.id}
								onChanged={refreshProjectContext}
							/>
						</DialogContent>
					</Dialog>
				)}
				{appearanceTarget && (
					<ProjectAppearanceDialog
						key={`${appearanceTarget.context.hostUrl}:${appearanceTarget.project.id}`}
						project={appearanceTarget.project}
						context={appearanceTarget.context}
						onUpdated={refreshProjectContext}
						onClose={() => setAppearanceTarget(null)}
					/>
				)}
				{removalTarget && (
					<ProjectRemovalDialog
						project={removalTarget.project}
						context={removalTarget.context}
						hasUnsavedFiles={projectHasDirtyFiles(
							removalTarget.context,
							removalTarget.project.id,
						)}
						getHasUnsavedFiles={() =>
							projectHasDirtyFiles(
								removalTarget.context,
								removalTarget.project.id,
							)
						}
						onClose={() => setRemovalTarget(null)}
						onRemove={async (context, removed) => {
							const removedIds = new Set(
								queryClient
									.getQueryData<Workspace[]>([
										"jedv",
										context.hostUrl,
										"workspaces",
									])
									?.filter((row) => row.projectId === removed.id)
									.map((row) => row.id),
							);
							if (projectHasDirtyFiles(context, removed.id))
								throw new Error(
									t({
										message:
											"Save or close the unsaved files before removing this project",
									}),
								);
							await context.client.project.remove.mutate({
								projectId: removed.id,
							});
							await refreshProjectContext(context);
							const file = fileTargetRef.current;
							if (
								file?.hostUrl === context.hostUrl &&
								removedIds.has(file.workspaceId)
							) {
								setFileTarget(null);
								setFilesDirty(false);
								areas.state.setState({
									rightAreaOpen: false,
									focusedArea: "left",
								});
								if (surface === "files") setSurface("terminal");
							}
							if (
								currentHost.current.client === context.client &&
								currentHost.current.hostUrl === context.hostUrl &&
								project?.id === removed.id
							) {
								setWorkspaceId(null);
								selectTerminal(null);
							}
						}}
					/>
				)}
				{scriptTarget && (
					<ProjectScriptsDialog
						key={`${scriptTarget.context.hostUrl}:${scriptTarget.projectId}:${scriptTarget.context.workspaceId}`}
						client={scriptTarget.context.client}
						hostUrl={scriptTarget.context.hostUrl}
						projectId={scriptTarget.projectId}
						onClose={() => setScriptTarget(null)}
						onReturnFocus={() => workspaceActionsRef.current?.focus()}
						onSaved={() =>
							void queryClient.invalidateQueries({
								queryKey: [
									"jedv",
									scriptTarget.context.hostUrl,
									scriptTarget.projectId,
									"workspace-run",
								],
							})
						}
					/>
				)}
				{palette && client && hostUrl && (
					<JedvCommandPalette
						key={`${hostUrl}:${palette}`}
						client={client}
						hostUrl={hostUrl}
						workspaceId={workspaceId}
						workspaces={workspaces.data ?? []}
						mode={palette}
						onClose={() => setPalette(null)}
						onWorkspace={(id) => void run(() => openWorkspace(id))}
						onFile={openFiles}
						actions={[
							...(recentlyDeleted.current.length
								? [
										{
											id: "undo",
											label: t({ message: "Undo last closed workspace" }),
											run: () =>
												setRestoreTarget(
													recentlyDeleted.current.at(-1) ?? null,
												),
										},
									]
								: []),
							...(workspace && !remote
								? [
										{
											id: "open-in-app",
											label: t({ message: "Open in Editor" }),
											run: () => void run(openWorkspaceInEditor),
										},
									]
								: []),
							{
								id: "reopen-tab",
								label: t({ message: "Reopen Closed Tab" }),
								run: () => terminalLayoutRef.current?.reopen(),
							},
							{
								id: "resources",
								label: t({ message: "Resources" }),
								run: () => setResourcesOpen(true),
							},

							{
								id: "active-workspaces",
								label: t({ message: "Active workspaces" }),
								run: () => setActiveSwitcherOpen(true),
							},
							{
								id: "welcome",
								label: t({ message: "Welcome to Jedv" }),
								run: () => setWelcomeReplay(true),
							},
							{
								id: "run-workspace",
								label: t({ message: "Run workspace command" }),
								run: () =>
									void run(async () => {
										await runActionRef.current?.();
									}),
							},
							{
								id: "project-open",
								label: t({ message: "Open project" }),
								run: () => projectAction("open"),
							},
							{
								id: "project-folder",
								label: t({ message: "Import plain folder" }),
								run: () => projectAction("folder"),
							},
							{
								id: "project-clone",
								label: t({ message: "Clone from URL" }),
								run: () => projectAction("clone"),
							},
							{
								id: "project-empty",
								label: t({ message: "Create new project" }),
								run: () => projectAction("empty"),
							},
							{
								id: "project-template",
								label: t({ message: "Start from a template" }),
								run: () => projectAction("template"),
							},
							{
								id: "terminal",
								label: t({ message: "New Terminal" }),
								run: () => void run(() => createTerminal()),
							},
							{
								id: "settings",
								label: t({ message: "Settings" }),
								run: () => navigate("settings"),
							},
							{
								id: "changes",
								label: t({ message: "Changes" }),
								run: () => {
									showChanges();
								},
							},
							{
								id: "board",
								label: t({ message: "Workspaces" }),
								run: () => navigate("board"),
							},
							{
								id: "create-team",
								label: t({ message: "Create team" }),
								run: () => navigate("create-team"),
							},
							{
								id: "automations",
								label: t({ message: "Automations" }),
								run: () => navigate("automations"),
							},
							{
								id: "pr",
								label: t({ message: "Pull Requests" }),
								run: () => navigate("pull-requests"),
							},
						]}
					/>
				)}
				{connecting && (
					<PrivateConnectionDialog
						onClose={() => {
							setConnecting(false);
							focusTerminal();
						}}
						onConnect={async (next) => {
							if (filesDirtyRef.current)
								throw new Error(
									t({
										message:
											"Save or close the unsaved files before switching hosts",
									}),
								);
							setFileTarget(null);
							if (remote && hostBaseUrl(remote) !== hostBaseUrl(next)) {
								knownConnections.current.delete(hostBaseUrl(remote));
								await disconnect.mutateAsync({ baseUrl: hostBaseUrl(remote) });
							}
							setWorkspaceId(null);
							selectTerminal(null);
							setRemote(next);
							setError(null);
						}}
					/>
				)}
				{workspaceCreation && (
					<CreateWorkspaceDialog
						context={workspaceCreation.context}
						projects={workspaceCreation.projects}
						initialProjectId={workspaceCreation.projectId}
						initialMode={workspaceCreation.mode}
						onRefresh={refreshProjectContext}
						onCreated={async ({
							context,
							workspaceId: createdId,
							terminalId: createdTerminal,
						}) => {
							if (
								currentHost.current.client === context.client &&
								currentHost.current.hostUrl === context.hostUrl
							)
								await openWorkspace(createdId, createdTerminal);
						}}
						onClose={() => setWorkspaceCreation(null)}
					/>
				)}
				{deleteTarget && (
					<JedvDeleteWorkspaceDialog
						context={deleteTarget.context}
						workspace={deleteTarget.workspace}
						hasUnsavedFiles={
							filesDirty &&
							fileTarget?.hostUrl === deleteTarget.context.hostUrl &&
							fileTarget?.workspaceId === deleteTarget.workspace.id
						}
						getHasUnsavedFiles={() =>
							filesDirtyRef.current &&
							fileTargetRef.current?.hostUrl === deleteTarget.context.hostUrl &&
							fileTargetRef.current?.workspaceId === deleteTarget.workspace.id
						}
						onRefresh={refreshProjectContext}
						onClose={() => setDeleteTarget(null)}
						onDeleted={async ({
							context,
							workspaceId: deletedId,
							warnings,
						}) => {
							if (deleteTarget.workspace.type !== "session")
								recentlyDeleted.current = [
									...recentlyDeleted.current.slice(-7),
									{
										context,
										workspace: {
											...deleteTarget.workspace,
											archivedAt: Date.now(),
										},
									},
								];
							if (
								currentHost.current.client === context.client &&
								currentHost.current.hostUrl === context.hostUrl &&
								workspaceId === deletedId
							) {
								setWorkspaceId(null);
								selectTerminal(null);
							}
							for (const warning of warnings) toast.warning(warning);
						}}
					/>
				)}

				{confirmation && (
					<JedvConfirmDialog
						confirmation={confirmation}
						onClose={() => {
							setConfirmation(null);
							focusTerminal();
						}}
					/>
				)}
				{createPortal(toolbarContent, toolbarHost)}
				<div
					id="jedv-toolbar-parking"
					hidden
					ref={(node) => {
						if (node && !toolbarHost.parentElement)
							node.appendChild(toolbarHost);
					}}
				/>
				{restoreTarget && (
					<RestoreWorkspaceButton
						key={`${restoreTarget.context.hostUrl}:${restoreTarget.workspace.id}`}
						initialOpen
						context={restoreTarget.context}
						workspace={restoreTarget.workspace}
						onDismiss={() => setRestoreTarget(null)}
						onRestored={async ({ context, workspaceId: restoredId }) => {
							await refreshProjectContext(context);
							recentlyDeleted.current = recentlyDeleted.current.filter(
								(entry) => entry !== restoreTarget,
							);
							setRestoreTarget(null);
							if (currentHost.current.hostUrl === context.hostUrl)
								await openWorkspace(restoredId);
						}}
					/>
				)}
				{leftSessionMenu.dialogs}
				{rightSessionMenu.dialogs}
				<ThemedToaster />
			</main>
		</WindowChromeContext>
	);
}
