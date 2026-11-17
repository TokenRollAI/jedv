import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	LuChevronRight,
	LuCircle,
	LuCircleHelp,
	LuCircleX,
	LuCrown,
	LuEllipsis,
	LuLoaderCircle,
	LuSquare,
	LuTerminal,
} from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import type { Project, Workspace } from "../../../../types";
import { TeamIconButton } from "../TeamIconButton";
export function TeamMemberCard({
	member,
	project,
	workspace,
	live,
	pending,
	onOpen,
	onStop,
}: {
	member: TeamMember;
	project?: Project;
	workspace?: Workspace;
	live: boolean;
	pending: boolean;
	onOpen(): void;
	onStop?: () => void;
}) {
	const { t } = useLingui();
	const task = member.taskSummary?.trim() ?? "";
	const firstLine = task.split(/\r?\n/, 1)[0] ?? "";
	const preview =
		firstLine.length > 160 ? `${firstLine.slice(0, 159)}…` : firstLine;
	const taskExpandable = task !== firstLine || firstLine.length > 160;
	const failed =
		member.status === "failed" || member.binding?.lastEventType === "Failed";
	const blocked =
		member.status === "reconcile_required" ||
		member.deliveryState === "permission";
	const starting = member.launchState === "starting";
	const working =
		starting ||
		member.status === "spawning" ||
		member.deliveryState === "working" ||
		member.deliveryState === "reserved";
	const stopped = member.status === "stopped";
	const label = starting
		? t({ message: "Starting" })
		: failed
			? t({ message: "Failed" })
			: blocked
				? t({ message: "Needs attention" })
				: stopped
					? t({ message: "Stopped" })
					: working
						? t({ message: "Working" })
						: member.deliveryState === "idle"
							? t({ message: "Idle" })
							: t({ message: "Waiting for agent status" });
	const shortLabel = starting
		? t({ message: "Starting" })
		: failed
			? t({ message: "Failed" })
			: blocked
				? t({ message: "Needs attention" })
				: stopped
					? t({ message: "Stopped" })
					: working
						? t({ message: "Working" })
						: t({ message: "Idle" });
	const StatusIcon = failed
		? LuCircleX
		: blocked
			? LuCircleHelp
			: working
				? LuLoaderCircle
				: stopped
					? LuSquare
					: member.deliveryState === "idle"
						? LuCircle
						: LuCircleHelp;
	const statusTone = failed
		? "bg-destructive/12 text-destructive"
		: blocked
			? "bg-warning/12 text-warning"
			: working
				? "bg-chart-1/12 text-chart-1"
				: "bg-muted/70 text-muted-foreground";
	const terminalLabel = live
		? t({ message: `Open ${member.name} terminal` })
		: t({ message: "Terminal unavailable" });
	return (
		<article className="flex min-w-0 flex-col justify-between gap-2.5 rounded-xl border border-border/70 bg-card/55 p-3.5 transition-colors hover:border-border">
			<div className="flex min-w-0 items-center gap-2">
				<AgentIcon presetId={member.agentId} className="size-4 shrink-0" />
				<span
					className="truncate text-[13px] font-medium text-foreground"
					title={`${member.name} · ${member.agentId}`}
				>
					{member.name}
				</span>
				{member.role === "leader" ? (
					<span className="inline-flex shrink-0 items-center gap-1 rounded bg-warning/12 px-1.5 py-0.5 text-[10px] font-medium text-warning">
						<LuCrown
							className="size-3 shrink-0"
							role="img"
							aria-label={t({ message: "Team leader" })}
							title={t({ message: "Team leader" })}
						/>
						<Trans>Leader</Trans>
					</span>
				) : (
					<span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
						<Trans>Worker</Trans>
					</span>
				)}
				<div className="ml-auto flex shrink-0 items-center gap-1">
					<span
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${statusTone}`}
						title={label}
					>
						<StatusIcon
							className={`size-3 shrink-0 ${working ? "animate-spin" : ""}`}
							aria-hidden="true"
						/>
						<span className="truncate">{shortLabel}</span>
					</span>
					{onStop && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<TeamIconButton
									label={t({ message: "More options" })}
									disabled={pending}
									className="size-6"
								>
									<LuEllipsis className="size-3.5" />
								</TeamIconButton>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onSelect={onStop}
									disabled={pending}
									className="text-destructive"
								>
									<LuSquare className="size-3.5" />
									{t({ message: `Stop ${member.name}` })}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
			<div className="min-w-0 space-y-1.5">
				{taskExpandable ? (
					<details className="group min-w-0 text-xs leading-relaxed text-muted-foreground">
						<summary
							aria-label={t({ message: "Full task instructions" })}
							title={preview}
							className="flex cursor-pointer list-none items-start gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
						>
							<LuChevronRight
								className="mt-0.5 size-3 shrink-0 transition-transform group-open:rotate-90"
								aria-hidden="true"
							/>
							<span className="min-w-0 flex-1 line-clamp-2">{preview}</span>
						</summary>
						<pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border/60 bg-background/60 p-2.5 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-foreground/85 select-text">
							{member.taskSummary}
						</pre>
					</details>
				) : (
					<p
						className="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
						title={preview}
					>
						{preview || t({ message: "No task assigned" })}
					</p>
				)}
				{member.lastError && (
					<details className="group text-xs text-destructive">
						<summary
							className="flex cursor-pointer list-none items-start gap-1 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
							title={member.lastError}
						>
							<LuChevronRight
								className="mt-0.5 size-3 shrink-0 transition-transform group-open:rotate-90"
								aria-hidden="true"
							/>
							<span className="min-w-0 flex-1 truncate">
								{member.lastError}
							</span>
						</summary>
						<p className="mt-1 whitespace-pre-wrap break-words">
							{member.lastError}
						</p>
					</details>
				)}
			</div>
			<div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/50 pt-2">
				<p
					className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80"
					title={`${project?.name ?? ""} / ${workspace?.name || workspace?.branch || member.workspaceId || ""}`}
				>
					{project?.name ?? t({ message: "Session" })} /{" "}
					{workspace?.name ||
						workspace?.branch ||
						t({ message: "Workspace unavailable" })}
				</p>
				<button
					type="button"
					aria-label={terminalLabel}
					title={terminalLabel}
					disabled={!live || pending}
					onClick={onOpen}
					className="inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
				>
					<LuTerminal className="size-3 shrink-0" />
					<span>
						<Trans>Terminal</Trans>
					</span>
				</button>
			</div>
		</article>
	);
}
