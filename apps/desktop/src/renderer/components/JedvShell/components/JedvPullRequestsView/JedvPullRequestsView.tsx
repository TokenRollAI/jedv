import { errorMessage } from "@jedv/i18n/errors";
import { formatCompactRelativeTime } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import { Skeleton } from "@jedv/ui/skeleton";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	LuGitPullRequest,
	LuListFilter,
	LuPlus,
	LuRefreshCw,
	LuSearch,
	LuUsers,
} from "react-icons/lu";
import type { JedvParityViewContext } from "../../parity-types";
import { supportsPullRequests } from "../../vcs-capabilities";
import { NonGitState } from "../NonGitState";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { CreatePullRequestDialog } from "./components/CreatePullRequestDialog";
import { PullRequestDetail } from "./components/PullRequestDetail/PullRequestDetail";
import { PullRequestStateIcon } from "./components/PullRequestStateIcon/PullRequestStateIcon";
import { usePullRequestSelection } from "./hooks/usePullRequestSelection";
import type { PullRequestTarget } from "./types";
export function JedvPullRequestsView(
	context: JedvParityViewContext & { initialTarget?: PullRequestTarget },
) {
	const { client, hostUrl, projects } = context;
	const { t } = useLingui();
	const [search, setSearch] = useState("");
	const [state, setState] = useState("open");
	const [projectId, setProjectId] = useState("");
	const [creating, setCreating] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const { selected, setSelected } = usePullRequestSelection(
		hostUrl,
		context.initialTarget,
	);
	const repoProjects = projects.flatMap((project) =>
		supportsPullRequests(project) &&
		project.repoOwner &&
		project.repoName &&
		(!projectId || project.id === projectId)
			? [
					{
						...project,
						repoOwner: project.repoOwner,
						repoName: project.repoName,
					},
				]
			: [],
	);
	const targets = Array.from(
		new Map(
			repoProjects.map((project) => [
				`${project.repoOwner}/${project.repoName}`.toLowerCase(),
				project,
			]),
		).values(),
	).sort((a, b) => a.id.localeCompare(b.id));
	const list = useInfiniteQuery({
		queryKey: [
			"jedv",
			hostUrl,
			"pr-list",
			targets.map((p) => [p.id, p.repoOwner, p.repoName]),
			state,
		],
		initialPageParam: 1,
		enabled: targets.length > 0,
		retry: false,
		staleTime: 30000,
		queryFn: async ({ pageParam }) => {
			const results = await Promise.allSettled(
				targets.map((project) =>
					client.github.listPRs.query({
						owner: project.repoOwner,
						repo: project.repoName,
						state:
							state === "open" ? "open" : state === "all" ? "all" : "closed",
						page: pageParam,
						perPage: 50,
						sort: "updated",
						direction: "desc",
					}),
				),
			);
			return {
				rows: results.flatMap((result, index) =>
					result.status === "fulfilled" && targets[index]
						? result.value.map((pr) => ({ pr, project: targets[index] }))
						: [],
				),
				errors: results.flatMap((result, index) =>
					result.status === "rejected"
						? [
								{
									project: targets[index]?.name ?? "",
									message: errorMessage(
										result.reason,
										t({ message: "Failed to load pull requests" }),
									),
								},
							]
						: [],
				),
				hasMore: results.some(
					(result) =>
						result.status === "fulfilled" && result.value.length === 50,
				),
			};
		},
		getNextPageParam: (lastPage, pages) =>
			lastPage.hasMore ? pages.length + 1 : undefined,
	});
	const rows =
		list.data?.pages
			.flatMap((page) => page.rows)
			.filter(
				({ pr }) =>
					(state !== "merged" || !!pr.merged_at) &&
					`${pr.title} #${pr.number} ${pr.head.ref} ${pr.user?.login}`
						.toLowerCase()
						.includes(search.toLowerCase()),
			)
			.sort((a, b) => {
				const bTime = new Date(b.pr.updated_at).getTime();
				const aTime = new Date(a.pr.updated_at).getTime();
				return (
					(Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
				);
			}) ?? [];
	const failures = list.data?.pages.flatMap((page) => page.errors) ?? [];
	const canCreatePullRequest = context.workspaces.some(
		(workspace) =>
			supportsPullRequests(workspace) &&
			projects.some(
				(project) =>
					project.id === workspace.projectId &&
					supportsPullRequests(project) &&
					project.repoOwner &&
					project.repoName,
			),
	);
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Pull requests" })}
		>
			<div className="shrink-0 border-b border-border">
				<WindowChrome primary className="gap-2 border-b border-border/60 pr-3">
					<WindowChromeLeading />
					<WindowChromeControls className="min-w-0 pl-3">
						<h1 className="truncate text-[13.5px] font-medium">
							<Trans>Pull requests</Trans>
						</h1>
					</WindowChromeControls>
					<div className="drag min-w-4 flex-1" />
					<WindowChromeControls className="jedv-chrome-toolbar">
						<div className="no-drag flex items-center gap-1.5">
							<div className="relative w-52">
								<LuSearch className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
								<Input
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									aria-label={t({ message: "Search pull requests" })}
									placeholder={t({ message: "Search pull requests…" })}
									className="h-7 border-border/60 bg-card/50 pl-7 text-xs shadow-none"
								/>
							</div>
							<Button
								size="icon"
								variant="ghost"
								className="size-7"
								disabled={list.isFetching || targets.length === 0}
								onClick={() => void list.refetch()}
								aria-label={t({ message: "Refresh pull requests" })}
							>
								<LuRefreshCw
									className={cn("size-3.5", list.isFetching && "animate-spin")}
								/>
							</Button>
							<Button
								size="sm"
								className="h-7.5 gap-1.5 px-3 text-xs"
								disabled={!canCreatePullRequest}
								onClick={() => setCreating(true)}
							>
								<LuPlus className="size-3.5" />
								<Trans>Create pull request</Trans>
							</Button>
						</div>
					</WindowChromeControls>
					<WindowControlsInset />
				</WindowChrome>
				<div className="flex shrink-0 flex-wrap items-center gap-1 px-6 py-2">
					{[
						{ id: "open", label: t({ message: "Open" }) },
						{ id: "merged", label: t({ message: "Merged" }) },
						{ id: "all", label: t({ message: "All" }) },
					].map((item) => (
						<button
							type="button"
							key={item.id}
							onClick={() => setState(item.id)}
							aria-pressed={state === item.id}
							className={cn(
								"h-8 rounded-lg px-3 text-[13px] transition-colors",
								state === item.id
									? "bg-secondary font-medium"
									: "text-muted-foreground hover:bg-accent/60",
							)}
						>
							{item.label}
						</button>
					))}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="sm"
								variant="ghost"
								className="ml-auto h-7 text-xs text-muted-foreground"
							>
								<LuListFilter className="size-3.5" />
								{projects.find((p) => p.id === projectId)?.name ??
									t({ message: "Filter" })}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
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
								{projects
									.filter(
										(p) => supportsPullRequests(p) && p.repoOwner && p.repoName,
									)
									.map((project) => (
										<DropdownMenuRadioItem key={project.id} value={project.id}>
											{project.name}
										</DropdownMenuRadioItem>
									))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{notice && (
				<output className="border-b border-border px-6 py-2 text-xs text-muted-foreground">
					{notice}
				</output>
			)}
			{(failures.length > 0 || list.error) && (
				<div
					role="alert"
					className="border-b border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive"
				>
					{list.error && (
						<p>
							{errorMessage(
								list.error,
								t({ message: "Failed to load pull requests" }),
							)}
						</p>
					)}
					{failures.map((failure, index) => (
						<p key={`${failure.project}:${index}`}>
							{failure.project}: {failure.message}
						</p>
					))}
					<Button
						size="sm"
						variant="ghost"
						className="mt-1 h-6"
						onClick={() => void list.refetch()}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
				<div
					className={cn(
						"flex min-h-0 min-w-0 flex-col",
						selected
							? "max-h-[35%] shrink-0 lg:max-h-none lg:w-[340px]"
							: "flex-1",
					)}
				>
					{list.isPending && targets.length > 0 && (
						<output
							aria-label={t({ message: "Loading pull requests…" })}
							className="space-y-2 p-3"
						>
							{["s1", "s2", "s3", "s4", "s5"].map((id) => (
								<div
									key={id}
									className="flex items-center gap-3 rounded-lg border border-border/40 p-2.5"
								>
									<Skeleton className="size-4 shrink-0 rounded-full" />
									<div className="flex min-w-0 flex-1 flex-col gap-1.5">
										<Skeleton className="h-3.5 w-3/5" />
										<Skeleton className="h-3 w-2/5" />
									</div>
									<Skeleton className="h-3 w-8 shrink-0" />
								</div>
							))}
						</output>
					)}
					<div className="min-h-0 flex-1 overflow-y-auto p-3">
						{rows.map(({ pr, project }) => {
							const merged = !!pr.merged_at;
							const active =
								selected?.number === pr.number &&
								selected.owner === project.repoOwner &&
								selected.repo === project.repoName;
							const reviewerCount = pr.requested_reviewers?.length ?? 0;
							return (
								<button
									type="button"
									key={`${project.repoOwner}/${project.repoName}#${pr.number}`}
									aria-current={active ? "true" : undefined}
									onClick={() =>
										setSelected({
											projectId: project.id,
											owner: project.repoOwner,
											repo: project.repoName,
											number: pr.number,
											title: pr.title,
										})
									}
									className={cn(
										"mb-0.5 flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
										active && "bg-accent",
									)}
								>
									<PullRequestStateIcon
										state={merged ? "merged" : pr.state}
										draft={pr.draft}
									/>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<div className="flex min-w-0 items-center gap-2">
											<span className="truncate text-[13px] font-medium">
												{pr.title}
											</span>
											{pr.draft && (
												<span className="inline-flex shrink-0 items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
													<Trans>Draft</Trans>
												</span>
											)}
										</div>
										<div className="flex min-w-0 items-center gap-2 text-muted-foreground/80">
											{pr.user?.avatar_url && (
												<img
													src={pr.user.avatar_url}
													alt={pr.user.login}
													className="size-4 shrink-0 rounded-full ring-1 ring-border/50"
												/>
											)}
											{pr.user?.login && (
												<span className="truncate text-[11px] font-medium">
													{pr.user.login}
												</span>
											)}
											<span className="truncate text-[10px]">
												{project.repoName}
											</span>
											<span className="shrink-0 text-[10px] tabular-nums">
												#{pr.number}
											</span>
											<span className="text-[11px]">·</span>
											<span className="truncate font-mono text-[11px]">
												{pr.head.ref}
											</span>
											{reviewerCount > 0 && (
												<span
													className="inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground"
													title={pr.requested_reviewers
														?.map((r) => r.login)
														.filter(Boolean)
														.join(", ")}
												>
													<LuUsers className="size-3" />
													{reviewerCount}
												</span>
											)}
										</div>
									</div>
									<div className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
										{formatCompactRelativeTime(new Date(pr.updated_at))}
									</div>
								</button>
							);
						})}
						{rows.length === 0 &&
							!list.isFetching &&
							failures.length === 0 &&
							!list.error &&
							(projects.length > 0 &&
							projects.every((project) => !supportsPullRequests(project)) ? (
								<NonGitState />
							) : (
								<div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
									<LuGitPullRequest className="size-8 text-muted-foreground/40" />
									<h2 className="text-sm font-medium">
										{targets.length === 0 ? (
											<Trans>No GitHub repositories available</Trans>
										) : (
											<Trans>No pull requests match your filters</Trans>
										)}
									</h2>
									<p className="max-w-sm text-xs text-muted-foreground">
										{targets.length === 0 ? (
											<Trans>
												Import a project with a GitHub remote to view its pull
												requests.
											</Trans>
										) : (
											<Trans>Try changing the search or status filter.</Trans>
										)}
									</p>
								</div>
							))}
						{list.hasNextPage && (
							<Button
								size="sm"
								variant="ghost"
								className="mx-auto mt-2 flex text-xs"
								disabled={list.isFetchingNextPage}
								onClick={() => void list.fetchNextPage()}
							>
								{list.isFetchingNextPage ? (
									<Trans>Loading…</Trans>
								) : (
									<Trans>Load more</Trans>
								)}
							</Button>
						)}
					</div>
				</div>
				{selected && (
					<PullRequestDetail
						key={`${hostUrl}:${selected.owner}/${selected.repo}#${selected.number}`}
						context={context}
						target={selected}
						onClose={() => setSelected(null)}
						onUpdated={() => void list.refetch()}
					/>
				)}
			</div>
			{creating && (
				<CreatePullRequestDialog
					key={hostUrl}
					context={context}
					onClose={() => setCreating(false)}
					onCreated={() => {
						setNotice(t({ message: "Pull request created" }));
						void list.refetch();
					}}
				/>
			)}
		</section>
	);
}
