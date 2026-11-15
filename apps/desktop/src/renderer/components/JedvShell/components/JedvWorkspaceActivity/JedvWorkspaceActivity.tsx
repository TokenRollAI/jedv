import { Button } from "@jedv/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	ArrowLeft,
	CircleCheck,
	CircleDot,
	CircleX,
	GitCompareArrows,
	ListTree,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JedvChangesView } from "../JedvChangesView";
import { CreatePullRequestDialog } from "../JedvPullRequestsView/components/CreatePullRequestDialog";
import { PullRequestStateIcon } from "../JedvPullRequestsView/components/PullRequestStateIcon";
import { AgentActivityRow } from "./components/AgentActivityRow";
import { BackgroundWorkRow } from "./components/BackgroundWorkRow";
import { ChangesMenuRow } from "./components/ChangesMenuRow";
import { ChangesStats } from "./components/ChangesStats";
import { MenuGroup } from "./components/MenuGroup";
import { PullRequestRow } from "./components/PullRequestRow";
import { ShipActionsMenu, type ShipView } from "./components/ShipActionsMenu";
import { useWorkspaceActivity } from "./hooks/useWorkspaceActivity";
import type { JedvWorkspaceActivityProps } from "./types";
import {
	activityEntries,
	needsAttention,
	runningWorkCount,
} from "./utils/activityEntries";
import { changesPillStats } from "./utils/changesPillStats";
import { collectBackgroundWork } from "./utils/collectBackgroundWork";
export function JedvWorkspaceActivity(props: JedvWorkspaceActivityProps) {
	const { t } = useLingui();
	const latest = useRef(props);
	latest.current = props;
	const [stopping, setStopping] = useState<Set<string>>(new Set());
	const stoppingRef = useRef(new Set<string>());
	const [now, setNow] = useState(Date.now());
	const [shipView, setShipView] = useState<ShipView | null>(null);
	const [floating, setFloating] = useState(false),
		[error, setError] = useState<string | null>(null);
	const panelId = useId();
	const [panelHost] = useState(() => {
		const element = document.createElement("div");
		element.style.display = "contents";
		return element;
	});
	const [floatingTarget, setFloatingTarget] = useState<HTMLDivElement | null>(
		null,
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const docked = !!props.dockTarget && !!props.dockFits && !props.dockHidden;
	const open = docked || floating;
	const setOpen = (next: boolean) => {
		if (props.dockFits) props.onDockHiddenChange?.(!next);
		else setFloating(next);
	};
	useEffect(() => {
		if (props.dockFits) setFloating(false);
	}, [props.dockFits]);
	useLayoutEffect(() => {
		const target = docked ? props.dockTarget : floatingTarget;
		const focused = panelHost.contains(document.activeElement)
			? document.activeElement
			: null;
		if (target) {
			target.appendChild(panelHost);
			if (focused instanceof HTMLElement) focused.focus();
		} else {
			panelHost.remove();
			if (focused) triggerRef.current?.focus();
		}
		return () => {
			if (panelHost.parentElement === target) panelHost.remove();
		};
	}, [docked, props.dockTarget, floatingTarget, panelHost]);

	const key = `${props.hostUrl}:${props.workspaceId}`,
		scope = useRef<string | null>(key);
	scope.current = key;
	const data = useWorkspaceActivity(props, open);
	const agents =
		props.agentSource.status === "ready"
			? activityEntries(
					props.hostUrl,
					props.workspaceId,
					props.agentSource.entries,
				)
			: [];
	const attention = agents.filter(needsAttention);
	const currentPr =
		props.pullRequestsEnabled === false
			? undefined
			: data.currentPr.data?.workspaces.find(
					(row) => row.workspaceId === props.workspaceId,
				)?.pullRequest;
	const background =
		props.attachedTerminalIds && data.terminals.data
			? collectBackgroundWork(
					data.terminals.data.sessions.filter(
						(session) =>
							!session.exited &&
							!props.attachedTerminalIds?.includes(session.terminalId),
					),
				)
			: null;
	const prs =
		props.pullRequestsEnabled === false
			? []
			: (data.prs.data?.workspaces.find(
					(item) => item.workspaceId === props.workspaceId,
				)?.pullRequests ?? []);
	useEffect(() => {
		scope.current = key;
		setFloating(false);
		setShipView(null);
		setError(null);
		return () => {
			if (scope.current === key) scope.current = null;
		};
	}, [key]);
	const navigate = async (work: () => void | Promise<void>) => {
		try {
			await work();
			if (scope.current === key) setFloating(false);
		} catch (cause) {
			if (scope.current === key) {
				setError(cause instanceof Error ? cause.message : String(cause));
				setOpen(true);
			}
		}
	};
	const openAgent = (entry: (typeof agents)[number]) =>
		props.onOpenAgent
			? () => void navigate(() => props.onOpenAgent?.(entry))
			: entry.terminalId
				? () =>
						void navigate(() => props.onOpenTerminal(entry.terminalId ?? ""))
				: undefined;
	const stats =
		props.gitEnabled !== false && data.git.data
			? changesPillStats(data.git.data)
			: null;
	const runningCount = runningWorkCount(agents, background ?? []);
	useEffect(() => {
		if (!open || !background?.length) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [open, background?.length]);
	const stopWork = async (terminalId: string) => {
		if (stoppingRef.current.has(terminalId)) return;
		stoppingRef.current.add(terminalId);
		setStopping(new Set(stoppingRef.current));
		setError(null);
		try {
			const list = await props.client.terminal.list.query({
				workspaceId: props.workspaceId,
			});
			if (
				scope.current !== key ||
				latest.current.attachedTerminalIds?.includes(terminalId) ||
				!list.sessions.some(
					(session) => session.terminalId === terminalId && !session.exited,
				)
			)
				return;
			await props.client.terminal.killSession.mutate({
				workspaceId: props.workspaceId,
				terminalId,
			});
		} catch (cause) {
			if (scope.current === key)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			stoppingRef.current.delete(terminalId);
			if (scope.current === key) {
				setStopping(new Set(stoppingRef.current));
				void data.terminals.refetch();
			}
		}
	};
	const rowClass = "px-2 py-1.5 text-xs text-muted-foreground/70";
	const panel = (
		<section
			id={panelId}
			aria-label={t({ message: "Workspace activity" })}
			data-activity-panel
			className="pointer-events-auto w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 text-popover-foreground shadow-sm"
			style={{
				maxHeight: docked
					? "min(480px, 100%)"
					: "min(480px, var(--radix-popover-content-available-height))",
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && shipView) {
					event.preventDefault();
					event.stopPropagation();
					setShipView(null);
					return;
				}
				if (shipView) return;
				if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
				const items = [
					...event.currentTarget.querySelectorAll<HTMLButtonElement>(
						"button:not([disabled])",
					),
				];
				if (!items.length) return;
				event.preventDefault();
				const index = items.indexOf(
					document.activeElement as HTMLButtonElement,
				);
				const step = event.key === "ArrowDown" ? 1 : -1;
				items[(index + step + items.length) % items.length]?.focus();
			}}
		>
			{error && (
				<p role="alert" className="break-words p-2 text-xs text-destructive">
					{error}
				</p>
			)}
			{shipView && props.shipContext ? (
				<div>
					<button
						type="button"
						className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:bg-accent"
						onClick={() => setShipView(null)}
					>
						<ArrowLeft className="size-3.5" />
						{shipView === "commit" ? (
							<Trans>Commit</Trans>
						) : shipView === "push" ? (
							<Trans>Push</Trans>
						) : (
							<Trans>Create PR</Trans>
						)}
					</button>
					{shipView === "pr" ? (
						<CreatePullRequestDialog
							inline
							initialWorkspaceId={props.workspaceId}
							context={props.shipContext}
							onClose={() => setShipView(null)}
							onCreated={() => {
								void data.currentPr.refetch();
								void data.prs.refetch();
							}}
						/>
					) : (
						<JedvChangesView
							shipOnly={shipView}
							client={props.client}
							hostUrl={props.hostUrl}
							workspaceId={props.workspaceId}
							active={open}
							remote={!!props.shipContext.remote}
							onOpenFile={(path, pinned) => props.onOpenFile?.(path, pinned)}
							getHasUnsavedFiles={props.getHasUnsavedFiles}
						/>
					)}
				</div>
			) : (
				<div className="divide-y divide-border">
					<section className="py-1">
						<div className="flex h-8 items-center justify-between gap-2 pl-2 pr-1">
							<span className="min-w-0 truncate text-xs text-muted-foreground">
								{props.workspaceName}
							</span>
							{props.gitEnabled !== false &&
								!currentPr &&
								props.shipContext && (
									<ShipActionsMenu
										canCommit={
											!!data.git.data &&
											(data.git.data.staged.length > 0 ||
												data.git.data.unstaged.length > 0)
										}
										canPush={!!data.git.data}
										canCreatePr={
											props.pullRequestsEnabled !== false &&
											props.shipContext.projects.some(
												(project) =>
													project.repoOwner &&
													project.repoName &&
													props.shipContext?.workspaces.some(
														(workspace) =>
															workspace.id === props.workspaceId &&
															workspace.projectId === project.id,
													),
											)
										}
										onOpen={setShipView}
									/>
								)}
						</div>
						{props.gitEnabled !== false && (
							<ChangesMenuRow
								stats={stats}
								isOpen={props.isChangesOpen ?? false}
								onToggle={() => void navigate(props.onOpenChanges)}
							/>
						)}
						{data.git.error && (
							<div role="alert" className={rowClass}>
								{data.git.error.message}
								<Button
									size="sm"
									variant="ghost"
									onClick={() => void data.git.refetch()}
								>
									<Trans>Retry</Trans>
								</Button>
							</div>
						)}
					</section>
					{props.pullRequestsEnabled !== false &&
						(data.prs.error || prs.length > 0) && (
							<MenuGroup
								title={<Trans>Pull requests</Trans>}
								count={prs.length}
							>
								{data.prs.error ? (
									<p role="alert" className={rowClass}>
										<Trans>Unavailable</Trans> · {data.prs.error.message}
										<Button
											size="sm"
											variant="ghost"
											onClick={() => void data.prs.refetch()}
										>
											<Trans>Retry</Trans>
										</Button>
									</p>
								) : data.prs.isPending ? (
									<p className={rowClass}>
										<Trans>Loading…</Trans>
									</p>
								) : !prs.length ? (
									<p className={rowClass}>
										<Trans>No linked pull requests</Trans>
									</p>
								) : (
									prs
										.slice(0, 100)
										.map((pr) => (
											<PullRequestRow
												key={`${pr.repoOwner}/${pr.repoName}#${pr.number}`}
												pullRequest={pr}
												onOpen={() =>
													void navigate(() => props.onOpenPullRequests(pr))
												}
											/>
										))
								)}
							</MenuGroup>
						)}
					{(props.agentSource.status === "unavailable" ||
						attention.length > 0) && (
						<MenuGroup
							title={<Trans>Needs attention</Trans>}
							count={attention.length}
						>
							{props.agentSource.status === "unavailable" ? (
								<p className={rowClass}>
									<Trans>Unavailable</Trans> · {props.agentSource.reason}
								</p>
							) : attention.length ? (
								attention.map((entry) => (
									<AgentActivityRow
										key={entry.entryId}
										entry={entry}
										onOpen={openAgent(entry)}
									/>
								))
							) : (
								<p className={rowClass}>
									<Trans>No pending responses or unread completions</Trans>
								</p>
							)}
						</MenuGroup>
					)}
					{agents.some((entry) => !needsAttention(entry)) && (
						<MenuGroup
							title={<Trans>Agents</Trans>}
							count={agents.filter((entry) => !needsAttention(entry)).length}
						>
							{agents
								.filter((entry) => !needsAttention(entry))
								.map((entry) => (
									<AgentActivityRow
										key={entry.entryId}
										entry={entry}
										onOpen={openAgent(entry)}
									/>
								))}
						</MenuGroup>
					)}
					{(props.attachedTerminalIds === undefined ||
						data.terminals.error ||
						(background?.length ?? 0) > 0) && (
						<MenuGroup
							title={<Trans>Background processes</Trans>}
							count={background?.length ?? 0}
						>
							{props.attachedTerminalIds === undefined ? (
								<p className={rowClass}>
									<Trans>Unavailable</Trans> ·{" "}
									<Trans>Pane attachment state is unavailable.</Trans>
								</p>
							) : data.terminals.error ? (
								<p role="alert" className={rowClass}>
									<Trans>Unavailable</Trans> · {data.terminals.error.message}
									<Button
										size="sm"
										variant="ghost"
										onClick={() => void data.terminals.refetch()}
									>
										<Trans>Retry</Trans>
									</Button>
								</p>
							) : data.terminals.isPending ? (
								<p className={rowClass}>
									<Trans>Loading…</Trans>
								</p>
							) : !background?.length ? (
								<p className={rowClass}>
									<Trans>No background terminals</Trans>
								</p>
							) : (
								background
									.slice(0, 100)
									.map((work) => (
										<BackgroundWorkRow
											key={work.key}
											work={work}
											now={now}
											stopping={stopping.has(work.terminalId)}
											onStop={() => void stopWork(work.terminalId)}
											onOpen={() =>
												void navigate(() =>
													props.onOpenTerminal(work.terminalId),
												)
											}
										/>
									))
							)}
						</MenuGroup>
					)}
				</div>
			)}
		</section>
	);
	return (
		<Popover
			open={floating && !props.dockFits}
			onOpenChange={(next) => {
				setFloating(next);
				if (!next) setShipView(null);
			}}
		>
			<Tooltip disableHoverableContent>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							ref={triggerRef}
							aria-expanded={open}
							aria-controls={open ? panelId : undefined}
							onClick={(event) => {
								event.preventDefault();
								setOpen(!open);
							}}
							aria-label={t({ message: "Workspace activity" })}
							className={cn(
								"no-drag relative flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
								"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								open
									? "border-foreground/30 bg-foreground/15 text-foreground hover:bg-foreground/20"
									: "border-border/60 bg-muted/30 text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground",
							)}
						>
							<ListTree className="size-3.5 shrink-0" />
							{runningCount > 0 && (
								<>
									<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />
									<span className="tabular-nums">{runningCount}</span>
								</>
							)}
							{currentPr ? (
								<>
									<span className="h-3.5 w-px shrink-0 bg-border" />
									<PullRequestStateIcon
										state={currentPr.state}
										draft={currentPr.state === "draft"}
									/>
									<span className="tabular-nums">#{currentPr.number}</span>
									{currentPr.checksStatus === "success" ? (
										<CircleCheck className="size-3 text-emerald-500" />
									) : currentPr.checksStatus === "failure" ? (
										<CircleX className="size-3 text-destructive" />
									) : currentPr.checksStatus === "pending" ? (
										<CircleDot className="size-3 text-muted-foreground" />
									) : null}
								</>
							) : (
								stats &&
								stats.fileCount > 0 && (
									<>
										<span className="h-3.5 w-px shrink-0 bg-border" />
										<GitCompareArrows className="size-3.5 shrink-0" />
										<span className="flex items-center gap-1">
											<ChangesStats stats={stats} />
										</span>
									</>
								)
							)}
							{attention.length > 0 && (
								<span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-blue-500" />
							)}
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{open ? (
						<Trans>Hide workspace activity</Trans>
					) : (
						<Trans>Show workspace activity</Trans>
					)}
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				ref={setFloatingTarget}
				onEscapeKeyDown={(event) => {
					if (shipView) {
						event.preventDefault();
						setShipView(null);
					}
				}}
				align="end"
				sideOffset={0}
				collisionPadding={{ top: 48, left: 8, right: 8, bottom: 8 }}
				className="w-80 max-w-[calc(100vw-1rem)] border-0 bg-transparent p-0 shadow-none"
			/>
			{createPortal(panel, panelHost)}
		</Popover>
	);
}
