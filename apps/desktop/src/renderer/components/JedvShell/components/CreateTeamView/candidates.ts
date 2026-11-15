import type { TeamSnapshot } from "../../hooks/useTeamwork";
import type { LocalClient } from "../../local-client";
import type { TerminalSession, Workspace } from "../../types";
export type LeaderBinding = Awaited<
	ReturnType<LocalClient["terminalAgents"]["list"]["query"]>
>[number];
export const leaderIdentity = (binding: LeaderBinding) =>
	JSON.stringify([
		binding.workspaceId,
		binding.terminalId,
		binding.launchId,
		binding.agentSessionId,
		binding.startedAt,
		binding.definitionId ?? "",
	]);
export function eligibleTeamLeaders(
	bindings: LeaderBinding[],
	sessions: Map<string, TerminalSession[]>,
	teams: TeamSnapshot[],
	workspaces: Workspace[],
) {
	const occupied = new Set(
		teams
			.filter(
				(row) => row.team.status === "active" || row.team.status === "paused",
			)
			.flatMap((row) =>
				row.members
					.filter(
						(member) => member.status !== "stopped" && member.endedAt == null,
					)
					.flatMap((member) =>
						[member.terminalId, member.plannedTerminalId].filter(
							(id): id is string => !!id,
						),
					),
			),
	);
	return bindings.flatMap((binding) => {
		if (
			binding.endedAt != null ||
			binding.chatSessionId ||
			!binding.launchId ||
			!binding.agentSessionId ||
			occupied.has(binding.terminalId)
		)
			return [];
		const workspace = workspaces.find(
			(workspace) =>
				workspace.id === binding.workspaceId && workspace.archivedAt == null,
		);
		const session = sessions
			.get(binding.workspaceId)
			?.find(
				(session) =>
					session.terminalId === binding.terminalId && !session.exited,
			);
		return workspace && session
			? [{ binding, session, workspace, id: leaderIdentity(binding) }]
			: [];
	});
}
