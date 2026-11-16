import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { useLingui } from "@lingui/react/macro";
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
	return (
		<article className="relative flex min-h-[88px] min-w-0 items-start gap-2 rounded-lg border border-border bg-card p-3">
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex min-w-0 items-center gap-2">
					<AgentIcon presetId={member.agentId} className="size-5" />
					<span
						className="truncate text-[13px] font-medium"
						title={`${member.name} · ${member.agentId}`}
					>
						{member.name}
					</span>
					{member.role === "leader" && (
						<LuCrown
							className="size-3.5 shrink-0 text-warning"
							role="img"
							aria-label={t({ message: "Team leader" })}
							title={t({ message: "Team leader" })}
						/>
					)}
					<span
						className={`absolute right-3 top-3 shrink-0 ${failed ? "text-destructive" : blocked ? "text-warning" : stopped || !working ? "text-muted-foreground" : "text-success"}`}
						title={label}
					>
						<StatusIcon
							className={`size-3.5 ${working ? "animate-spin" : ""}`}
							aria-hidden="true"
						/>
						<span className="sr-only">{label}</span>
					</span>
				</div>
				{taskExpandable ? (
					<details className="group min-w-0 text-xs leading-4 text-foreground/80">
						<summary
							aria-label={t({ message: "Full task instructions" })}
							title={preview}
							className="flex cursor-pointer list-none items-start gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
						>
							<LuChevronRight
								className="mt-0.5 size-3 shrink-0 transition-transform group-open:rotate-90"
								aria-hidden="true"
							/>
							<span className="min-w-0 flex-1 truncate">{preview}</span>
						</summary>
						<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 select-text">
							{member.taskSummary}
						</pre>
					</details>
				) : (
					<p
						className="truncate text-xs leading-4 text-foreground/80"
						title={preview}
					>
						{preview || t({ message: "No task assigned" })}
					</p>
				)}
				<p
					className="truncate text-[11px] text-muted-foreground"
					title={`${project?.name ?? ""} / ${workspace?.name || workspace?.branch || member.workspaceId || ""}`}
				>
					{project?.name ?? t({ message: "Session" })} /{" "}
					{workspace?.name ||
						workspace?.branch ||
						t({ message: "Workspace unavailable" })}
				</p>
				{member.lastError && (
					<details className="group text-xs text-destructive">
						<summary
							className="flex cursor-pointer list-none items-start gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
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
			<div className="grid w-14 shrink-0 grid-cols-2 items-center gap-0.5 self-center pt-4">
				<TeamIconButton
					label={
						live
							? t({ message: `Open ${member.name} terminal` })
							: t({ message: "Terminal unavailable" })
					}
					disabled={!live || pending}
					onClick={onOpen}
				>
					<LuTerminal className="size-4" />
				</TeamIconButton>
				{onStop && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<TeamIconButton
								label={t({ message: "More options" })}
								disabled={pending}
							>
								<LuEllipsis className="size-4" />
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
		</article>
	);
}
