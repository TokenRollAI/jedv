import {
	agentStatusFromEvent,
	highestAgentStatus,
} from "@jedv/shared/agent-status";
import type { LocalClient } from "../../local-client";
import type { Workspace } from "../../types";
import type { ActiveWorkspaceItem } from "../JedvWorkspaceRow";
export type ActiveBinding = Awaited<
	ReturnType<LocalClient["terminalAgents"]["list"]["query"]>
>[number];
export function activeWorkspaceItems(
	workspaces: Workspace[],
	bindings: ActiveBinding[],
): ActiveWorkspaceItem[] {
	const byWorkspace = new Map<string, ActiveBinding[]>();
	for (const binding of bindings) {
		if (binding.endedAt != null) continue;
		const rows = byWorkspace.get(binding.workspaceId) ?? [];
		rows.push(binding);
		byWorkspace.set(binding.workspaceId, rows);
	}
	return workspaces.flatMap((workspace) => {
		if (workspace.archivedAt != null) return [];
		const status = highestAgentStatus(
			(byWorkspace.get(workspace.id) ?? []).map((binding) =>
				agentStatusFromEvent(binding.lastEventType),
			),
		);
		return status ? [{ workspace, status }] : [];
	});
}
