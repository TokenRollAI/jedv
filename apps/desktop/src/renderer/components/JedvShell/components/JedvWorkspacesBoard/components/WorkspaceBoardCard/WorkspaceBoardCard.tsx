import { useFormat } from "@jedv/i18n/react";
import { cn } from "@jedv/ui/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
	LuCircle,
	LuCircleAlert,
	LuCircleCheck,
	LuGitBranch,
	LuGitPullRequest,
	LuLoader,
	LuPin,
} from "react-icons/lu";
import type { Project, Workspace } from "../../../../types";
import {
	ProjectThumbnail,
	resolveProjectIconUrl,
} from "../../../JedvProjectActions";
import {
	type Column,
	columnColors,
	columnLabels,
	type WorkspacePR,
} from "../../utils/board-state";
export function WorkspaceBoardCard({
	workspace,
	project,
	pr,
	column,
	pinned,
	onOpen,
	diffStats,
}: {
	workspace: Workspace;
	project?: Project;
	pr?: WorkspacePR;
	column: Column;
	pinned?: boolean;
	onOpen(): void;
	diffStats?: { additions: number; deletions: number; fileCount: number };
}) {
	const { i18n } = useLingui();
	const checkLabels = {
		success: msg({ message: "Checks passed" }),
		failure: msg({ message: "Checks failed" }),
		pending: msg({ message: "Checks running" }),
		none: msg({ message: "No checks" }),
	};
	const { formatCompactRelativeTime, formatNumber } = useFormat();
	const archived = workspace.archivedAt != null;
	const Icon =
		column === "working"
			? LuLoader
			: column === "attention"
				? LuCircleAlert
				: column === "finished" || column === "merged"
					? LuCircleCheck
					: LuCircle;
	return (
		<button
			type="button"
			onClick={onOpen}
			disabled={archived}
			className={cn(
				"w-full rounded-lg border border-border/50 bg-card px-3.5 py-3 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				archived
					? "cursor-default opacity-60"
					: "cursor-pointer hover:border-border hover:bg-accent/30",
			)}
		>
			<div className="mb-1.5 flex items-center gap-1.5 pr-4 text-[11px] text-muted-foreground">
				<ProjectThumbnail
					projectName={
						project?.name ??
						workspace.projectName ??
						workspace.name ??
						workspace.branch
					}
					color={project?.color}
					iconUrl={project ? resolveProjectIconUrl(project) : null}
					className="size-4 text-[10px]"
				/>
				{pinned && <LuPin className="size-3 shrink-0" />}
				<span className="min-w-0 truncate">
					{project?.name ?? workspace.projectName}
				</span>
				<span className="ml-auto whitespace-nowrap tabular-nums">
					{formatCompactRelativeTime(
						workspace.archivedAt ??
							workspace.lastActivityAt ??
							workspace.createdAt,
					)}
				</span>
			</div>
			<p
				className={cn(
					"line-clamp-2 min-w-0 text-[13px] font-medium leading-[18px]",
					archived || column === "merged"
						? "text-muted-foreground"
						: "text-foreground",
				)}
			>
				{workspace.name || workspace.branch}
			</p>
			{workspace.branch.toLowerCase() !== workspace.name?.toLowerCase() && (
				<div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
					<LuGitBranch className="size-3 shrink-0" />
					<code className="min-w-0 truncate font-mono">{workspace.branch}</code>
				</div>
			)}
			<div className="mt-2 flex items-center gap-1.5">
				{pr?.pullRequest && (
					<span className="inline-flex h-5 items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 text-[11px] text-muted-foreground">
						<LuGitPullRequest className="size-3" />#{pr.pullRequest.number}
						<span>{i18n._(checkLabels[pr.pullRequest.checksStatus])}</span>
					</span>
				)}
				{diffStats && diffStats.fileCount > 0 && (
					<span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 text-[11px] tabular-nums">
						{diffStats.additions > 0 && (
							<span className="text-emerald-600 [.dark_&]:text-[#34d399]">
								+
								{formatNumber(diffStats.additions, {
									notation: "compact",
									maximumFractionDigits: 1,
								})}
							</span>
						)}
						{diffStats.deletions > 0 && (
							<span className="text-red-600 [.dark_&]:text-[#f87171]">
								−
								{formatNumber(diffStats.deletions, {
									notation: "compact",
									maximumFractionDigits: 1,
								})}
							</span>
						)}
						{diffStats.additions === 0 && diffStats.deletions === 0
							? formatNumber(diffStats.fileCount)
							: null}
					</span>
				)}
				<Icon
					aria-label={i18n._(columnLabels[column])}
					className={cn(
						"ml-auto size-3",
						columnColors[column],
						column === "working" && "animate-spin motion-reduce:animate-none",
					)}
				/>
			</div>
			{pr?.error && (
				<p className="mt-1 text-[11px] text-destructive">{pr.error}</p>
			)}
		</button>
	);
}
