import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	LuCircle,
	LuListFilter,
	LuPlus,
	LuRefreshCw,
	LuSearch,
	LuSettings2,
	LuTrash2,
} from "react-icons/lu";
import type { Workspace } from "../../types";
import {
	BulkDeleteWorkspaceQueue,
	type DeletedWorkspaceResult,
	JedvDeleteWorkspaceDialog,
} from "../JedvDeleteWorkspaceDialog";
import type { ProjectActionContext } from "../JedvProjectActions";
import { useWorkspacePresentation } from "../JedvWorkspaceRow";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { WorkspaceBoardActions } from "./components/WorkspaceBoardActions";
import { WorkspaceBoardCard } from "./components/WorkspaceBoardCard/WorkspaceBoardCard";
import {
	markWorkspaceRead,
	markWorkspaceUnread,
	reconcileWorkspaceReadReceipts,
	useWorkspaceReadReceipts,
	workspaceReadThrough,
} from "./stores/read-receipts";
import type { JedvWorkspacesBoardProps } from "./types";
import {
	boardColumn,
	columnColors,
	columnLabels,
	columns,
} from "./utils/board-state";
export function JedvWorkspacesBoard({
	client,
	hostUrl,
	remote,
	projects,
	workspaces,
	onOpenWorkspace,
	onOpenCreateWorkspace,
	getHasUnsavedFiles,
	onWorkspaceDeleted,
	onOpenWorkspaceInContext,
}: JedvWorkspacesBoardProps) {
	const { t, i18n } = useLingui();
	const queries = useQueryClient();
	const currentHost = useRef({ hostUrl, mounted: true });
	currentHost.current.hostUrl = hostUrl;
	useEffect(() => {
		currentHost.current.mounted = true;
		return () => {
			currentHost.current.mounted = false;
		};
	}, []);
	const context: ProjectActionContext = {
		client,
		hostUrl,
		hostLabel: hostUrl,
		isRemote: !!remote,
	};
	const [deleting, setDeleting] = useState<{
		context: ProjectActionContext;
		workspace: Workspace;
	} | null>(null);
	const [bulk, setBulk] = useState<{
		context: ProjectActionContext;
		workspaces: Workspace[];
	} | null>(null);
	const dirtyGetter = useRef(getHasUnsavedFiles);
	dirtyGetter.current = getHasUnsavedFiles;
	const hasUnsavedFiles = (target: ProjectActionContext, workspaceId: string) =>
		dirtyGetter.current?.(target, workspaceId) ?? true;
	const changed = async (target: ProjectActionContext) => {
		await Promise.all([
			queries.invalidateQueries({
				queryKey: ["jedv", target.hostUrl, "workspaces"],
			}),
			queries.invalidateQueries({
				queryKey: ["jedv", target.hostUrl, "board-workspaces"],
			}),
			queries.invalidateQueries({
				queryKey: ["jedv", target.hostUrl, "board-agents"],
			}),
			queries.invalidateQueries({
				queryKey: ["jedv", target.hostUrl, "bindings"],
			}),
			queries.invalidateQueries({
				queryKey: ["jedv", target.hostUrl, "active-switcher-agents"],
			}),
			queries.invalidateQueries({
				queryKey: ["jedv", target.hostUrl, "board-prs"],
			}),
		]);
	};
	const opened = async ({
		context: target,
		workspaceId,
	}: {
		context: ProjectActionContext;
		workspaceId: string;
	}) => {
		if (onOpenWorkspaceInContext)
			await onOpenWorkspaceInContext({ context: target, workspaceId });
		else if (
			currentHost.current.mounted &&
			currentHost.current.hostUrl === target.hostUrl
		)
			await onOpenWorkspace(workspaceId);
	};
	const deleted = async (result: DeletedWorkspaceResult) => {
		await onWorkspaceDeleted?.(result);
	};
	const [search, setSearch] = useState("");
	const [view, setView] = useState("all");
	const [projectId, setProjectId] = useState("");
	const [showArchived, setShowArchived] = useState(false);
	const [sort, setSort] = useState("activity");
	const receipts = useWorkspaceReadReceipts((state) => state.receipts);
	const [openError, setOpenError] = useState<string | null>(null);
	const all = useQuery({
		queryKey: ["jedv", hostUrl, "board-workspaces", showArchived],
		queryFn: () =>
			client.workspace.list.query({ includeArchived: showArchived }),
		initialData: showArchived ? undefined : workspaces,
		refetchInterval: 5000,
	});
	const rows = all.data ?? workspaces;
	const diffIds = rows
		.filter(
			(workspace) => workspace.archivedAt == null && workspace.worktreeExists,
		)
		.map((workspace) => workspace.id);
	const diffStats = useQuery({
		queryKey: ["jedv", hostUrl, "board-diff-stats", diffIds],
		queryFn: async () => {
			const batches = [];
			for (let i = 0; i < diffIds.length; i += 500)
				batches.push(diffIds.slice(i, i + 500));
			const results = await Promise.all(
				batches.map((workspaceIds) =>
					client.git.getDiffStatsByWorkspaces.query({ workspaceIds }),
				),
			);
			return results.flatMap((result) => result.workspaces);
		},
		enabled: diffIds.length > 0,
		retry: false,
		staleTime: 15000,
		refetchInterval: 30000,
	});
	const presentation = useWorkspacePresentation(
		context,
		rows.filter((row) => row.archivedAt == null),
	);
	const ids = rows.map((w) => w.id).sort();
	useEffect(() => {
		if (all.isSuccess)
			reconcileWorkspaceReadReceipts(
				hostUrl,
				(all.data ?? []).filter((w) => w.archivedAt == null).map((w) => w.id),
			);
	}, [hostUrl, all.isSuccess, all.data]);
	const agents = useQuery({
		queryKey: ["jedv", hostUrl, "board-agents"],
		queryFn: () => client.terminalAgents.list.query(),
		refetchInterval: 3000,
		retry: false,
	});
	const prs = useQuery({
		queryKey: ["jedv", hostUrl, "board-prs", ids],
		queryFn: () =>
			client.pullRequests.getByWorkspaces.query({ workspaceIds: ids }),
		refetchInterval: 15000,
		retry: false,
	});
	const states = rows
		.map((workspace) => {
			const bindings =
				agents.data?.filter((b) => b.workspaceId === workspace.id) ?? [];
			const pr = prs.data?.workspaces.find(
				(p) => p.workspaceId === workspace.id,
			);
			const lastEvent = Math.max(0, ...bindings.map((b) => b.lastEventAt));
			const readAt =
				workspaceReadThrough(receipts, hostUrl, workspace.id) >= lastEvent
					? workspaceReadThrough(receipts, hostUrl, workspace.id)
					: 0;
			return {
				workspace,
				pr,
				column: boardColumn(
					workspace,
					bindings,
					pr?.pullRequest ?? null,
					readAt,
				),
				lastEvent,
			};
		})
		.filter(
			({ workspace, column }) =>
				(showArchived || workspace.archivedAt == null) &&
				(!projectId || workspace.projectId === projectId) &&
				(view === "all" ||
					(view === "attention"
						? column === "attention" || column === "finished"
						: column === "working")) &&
				`${workspace.name} ${workspace.branch} ${workspace.projectName}`
					.toLowerCase()
					.includes(search.toLowerCase()),
		)
		.sort((a, b) =>
			sort === "name"
				? (a.workspace.name ?? a.workspace.branch).localeCompare(
						b.workspace.name ?? b.workspace.branch,
					)
				: Number(b.workspace.lastActivityAt ?? b.workspace.createdAt) -
					Number(a.workspace.lastActivityAt ?? a.workspace.createdAt),
		);
	const refresh = useMutation({
		mutationFn: async () => {
			setOpenError(null);
			await Promise.all([all.refetch(), agents.refetch()]);
			await client.pullRequests.refreshByWorkspaces.mutate({
				workspaceIds: ids,
			});
			await prs.refetch();
		},
		onError: (cause) =>
			setOpenError(
				errorMessage(cause, t({ message: "Failed to refresh pull requests" })),
			),
	});
	const githubHold = prs.data?.github;
	const holdLabels = {
		auth: t({
			message:
				"GitHub authentication failed. Sign in with gh on this host, then refresh.",
		}),
		"rate-limited": t({
			message: "GitHub rate limit reached. PR links may be out of date.",
		}),
		unreachable: t({
			message: "GitHub is unreachable. PR links may be out of date.",
		}),
	};
	const errors = [
		all.error,
		agents.error,
		prs.error,
		presentation.error,
	].filter(Boolean);
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Workspaces" })}
		>
			<div className="shrink-0 border-b border-border">
				<WindowChrome primary className="gap-2 pr-3">
					<WindowChromeLeading />
					<WindowChromeControls className="min-w-0 pl-3">
						<h1 className="truncate text-lg font-semibold">
							<Trans>Workspaces</Trans>
						</h1>
					</WindowChromeControls>
					<div className="drag min-w-4 flex-1" />
					<WindowChromeControls className="jedv-chrome-toolbar">
						<div className="no-drag flex items-center gap-2">
							<div className="relative w-56">
								<LuSearch className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
								<Input
									className="h-8 border-none bg-muted/40 pl-7 text-xs"
									aria-label={t({ message: "Search workspaces" })}
									placeholder={t({ message: "Search workspaces…" })}
									value={search}
									onChange={(e) => setSearch(e.target.value)}
								/>
							</div>
							<Button
								size="sm"
								onClick={() => onOpenCreateWorkspace(projectId || undefined)}
							>
								<LuPlus className="size-3.5" />
								<Trans>Create workspace</Trans>
							</Button>
						</div>
					</WindowChromeControls>
					<WindowControlsInset />
				</WindowChrome>
				<div className="flex items-center gap-1 px-6 py-2">
					{[
						{ id: "all", label: t({ message: "All" }) },
						{ id: "attention", label: t({ message: "Needs me" }) },
						{ id: "working", label: t({ message: "Working" }) },
					].map((item) => (
						<button
							key={item.id}
							type="button"
							aria-pressed={view === item.id}
							className={cn(
								"h-8 rounded-lg px-3 text-[13px] transition-colors",
								view === item.id
									? "bg-secondary font-medium"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							onClick={() => setView(item.id)}
						>
							{item.label}
						</button>
					))}
				</div>
				<div className="flex h-10 items-center justify-between px-6">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-0 text-xs text-muted-foreground"
							>
								<LuListFilter className="size-3.5" />
								<Trans>Filter</Trans>
								{projectId && (
									<span className="rounded bg-secondary px-1">1</span>
								)}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuLabel>
								<Trans>Project</Trans>
							</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={projectId}
								onValueChange={setProjectId}
							>
								<DropdownMenuRadioItem value="">
									<Trans>All projects</Trans>
								</DropdownMenuRadioItem>
								{projects.map((project) => (
									<DropdownMenuRadioItem key={project.id} value={project.id}>
										{project.name}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto mr-3 text-xs"
						disabled={
							!getHasUnsavedFiles ||
							!states.some(({ workspace }) => workspace.archivedAt == null)
						}
						title={
							!getHasUnsavedFiles
								? t({
										message:
											"Unsaved file protection is unavailable. Delete this workspace from the sidebar.",
									})
								: undefined
						}
						onClick={() =>
							setBulk({
								context: { ...context },
								workspaces: states
									.map(({ workspace }) => workspace)
									.filter((row) => row.archivedAt == null),
							})
						}
					>
						<LuTrash2 className="size-3.5" />
						<Trans>Delete multiple workspaces</Trans>
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-0 text-xs text-muted-foreground"
							>
								<LuSettings2 className="size-3.5" />
								<Trans>Display</Trans>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>
								<Trans>Order by</Trans>
							</DropdownMenuLabel>
							<DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
								<DropdownMenuRadioItem value="activity">
									<Trans>Last activity</Trans>
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="name">
									<Trans>Name</Trans>
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={showArchived}
								onCheckedChange={setShowArchived}
							>
								<Trans>Show deleted workspaces</Trans>
							</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{(errors.length > 0 || openError) && (
				<div
					role="alert"
					className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive"
				>
					<span>
						{openError ??
							errorMessage(
								errors[0],
								t({ message: "Failed to load workspace status" }),
							)}
					</span>
					<Button
						size="sm"
						variant="ghost"
						disabled={refresh.isPending}
						onClick={() => refresh.mutate()}
					>
						<LuRefreshCw className="size-3" />
						<Trans>Refresh</Trans>
					</Button>
				</div>
			)}
			{githubHold && (
				<div
					role="alert"
					className="flex items-center gap-2 border-b border-border px-6 py-2 text-xs text-muted-foreground"
				>
					<span title={githubHold.detail}>{holdLabels[githubHold.reason]}</span>
					<Button
						size="sm"
						variant="ghost"
						className="h-6"
						disabled={refresh.isPending}
						onClick={() => refresh.mutate()}
					>
						<Trans>Refresh</Trans>
					</Button>
				</div>
			)}
			{(all.isPending || agents.isPending) && (
				<output className="px-6 py-2 text-xs text-muted-foreground">
					<Trans>Loading workspace status…</Trans>
				</output>
			)}
			{states.length === 0 && !all.isPending && (
				<p className="px-6 pt-5 text-sm text-muted-foreground">
					{search || projectId || view !== "all" ? (
						<Trans>No workspaces match your filters</Trans>
					) : (
						<Trans>No workspaces yet. Create a workspace to get started.</Trans>
					)}
				</p>
			)}
			<div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-6">
				{columns
					.filter((column) => showArchived || column !== "deleted")
					.map((column) => (
						<div
							key={column}
							className="flex w-[280px] min-w-[280px] shrink-0 flex-col rounded-lg bg-muted/30"
						>
							<div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
								<LuCircle className={cn("size-3", columnColors[column])} />
								<span className="truncate text-[13px] font-medium">
									{i18n._(columnLabels[column])}
								</span>
								<span className="text-xs tabular-nums text-muted-foreground">
									{states.filter((w) => w.column === column).length}
								</span>
							</div>
							<div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
								{states
									.filter((w) => w.column === column)
									.map(({ workspace, pr, lastEvent }) => (
										<WorkspaceBoardActions
											key={`${hostUrl}:${workspace.id}`}
											context={context}
											workspace={workspace}
											pinned={presentation.pinnedIds.has(workspace.id)}
											pinAvailable={presentation.available}
											pinPending={presentation.pending}
											onTogglePin={() =>
												presentation.setPinned(
													workspace.id,
													!presentation.pinnedIds.has(workspace.id),
												)
											}
											onDelete={() =>
												setDeleting({ context: { ...context }, workspace })
											}
											canDelete={!!getHasUnsavedFiles}
											onChanged={changed}
											onRestored={async (result) => {
												await changed(result.context);
												await opened(result);
											}}
											unread={
												workspaceReadThrough(receipts, hostUrl, workspace.id) <
													0 ||
												workspaceReadThrough(receipts, hostUrl, workspace.id) <
													lastEvent
											}
											onMarkUnread={() =>
												markWorkspaceUnread(hostUrl, workspace.id)
											}
											onMarkRead={() =>
												markWorkspaceRead(hostUrl, workspace.id, lastEvent)
											}
											hasPullRequest={!!pr?.pullRequest}
										>
											<WorkspaceBoardCard
												diffStats={diffStats.data?.find(
													(stats) => stats.workspaceId === workspace.id,
												)}
												workspace={workspace}
												project={projects.find(
													(row) => row.id === workspace.projectId,
												)}
												pr={pr}
												column={column}
												pinned={presentation.pinnedIds.has(workspace.id)}
												onOpen={() => {
													setOpenError(null);
													void opened({
														context: { ...context },
														workspaceId: workspace.id,
													}).catch((cause) =>
														setOpenError(
															errorMessage(
																cause,
																t({ message: "Failed to open workspace" }),
															),
														),
													);
												}}
											/>
										</WorkspaceBoardActions>
									))}
							</div>
						</div>
					))}
			</div>
			{deleting && (
				<JedvDeleteWorkspaceDialog
					key={`${deleting.context.hostUrl}:${deleting.workspace.id}`}
					context={deleting.context}
					workspace={deleting.workspace}
					hasUnsavedFiles={hasUnsavedFiles(
						deleting.context,
						deleting.workspace.id,
					)}
					getHasUnsavedFiles={() =>
						hasUnsavedFiles(deleting.context, deleting.workspace.id)
					}
					onRefresh={changed}
					onDeleted={deleted}
					onClose={() => setDeleting(null)}
				/>
			)}
			{bulk && (
				<BulkDeleteWorkspaceQueue
					context={bulk.context}
					workspaces={bulk.workspaces}
					hasUnsavedFiles={(id) => hasUnsavedFiles(bulk.context, id)}
					onRefresh={changed}
					onDeleted={deleted}
					onClose={() => setBulk(null)}
				/>
			)}
		</section>
	);
}
