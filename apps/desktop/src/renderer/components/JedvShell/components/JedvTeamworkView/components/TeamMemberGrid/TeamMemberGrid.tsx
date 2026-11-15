import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import type { Project, Workspace } from "../../../../types";
import { TeamMemberCard } from "../TeamMemberCard";
export const memberNeedsAttention = (member: TeamMember) =>
	member.status === "failed" ||
	member.status === "reconcile_required" ||
	member.deliveryState === "permission" ||
	member.binding?.lastEventType === "Failed";
export const collapsedMemberLimit = (columns: number) =>
	columns <= 2 ? 3 : columns * 2;
export function TeamMemberGrid({
	members,
	projects,
	workspaces,
	pending,
	canStop,
	live,
	onOpen,
	onStop,
}: {
	members: TeamMember[];
	projects: Project[];
	workspaces: Workspace[];
	pending: boolean;
	canStop: boolean;
	live: Set<string>;
	onOpen(member: TeamMember): void;
	onStop(member: TeamMember): void;
}) {
	const { t } = useLingui();
	const [element, setElement] = useState<HTMLDivElement | null>(null),
		[columns, setColumns] = useState(1),
		[expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (!element) return;
		const update = (width: number) =>
			setColumns(Math.max(1, Math.floor((width + 8) / 248)));
		update(element.clientWidth);
		const observer = new ResizeObserver((entries) => {
			if (entries[0]) update(entries[0].contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	const limit = collapsedMemberLimit(columns),
		hidden = members.slice(limit),
		hiddenCount = hidden.length,
		attention = hidden.filter(memberNeedsAttention).length;
	return (
		<div className="space-y-2">
			<div
				ref={setElement}
				className="grid gap-2"
				style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
			>
				{(expanded ? members : members.slice(0, limit)).map((member) => (
					<TeamMemberCard
						key={member.id}
						member={member}
						project={projects.find(
							(project) => project.id === member.projectId,
						)}
						workspace={workspaces.find(
							(workspace) => workspace.id === member.workspaceId,
						)}
						live={
							!!member.terminalId &&
							live.has(member.terminalId) &&
							workspaces.some(
								(workspace) =>
									workspace.id === member.workspaceId &&
									workspace.archivedAt == null,
							)
						}
						pending={pending}
						onOpen={() => onOpen(member)}
						onStop={
							canStop && member.role === "worker" && member.status !== "stopped"
								? () => onStop(member)
								: undefined
						}
					/>
				))}
			</div>
			{hiddenCount > 0 && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-auto min-h-7 gap-2 text-xs text-muted-foreground"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? (
						t({ message: "Show less" })
					) : (
						<Trans>Show {hiddenCount} more</Trans>
					)}
					{!expanded && attention > 0 && (
						<span className="text-warning">
							<Trans>{attention} need attention</Trans>
						</span>
					)}
				</Button>
			)}
		</div>
	);
}
