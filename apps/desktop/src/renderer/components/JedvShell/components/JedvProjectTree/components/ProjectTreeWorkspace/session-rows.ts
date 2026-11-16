import type { TerminalSession } from "../../../../types";
import type { ActiveBinding } from "../../../ActiveWorkspaceSwitcher/active-workspaces";
import { terminalSessionRows } from "../../../JedvTerminalTabStrip/utils/session-list/session-list";
import {
	paneTerminalId,
	type TerminalLayoutStore,
	workspacePaneAreas,
} from "../../../JedvTerminalWorkspace/layout";

export type WorkspaceAgentSession = {
	terminalId: string;
	name: string;
	provider: string;
	location: "tab" | "right" | "background" | "unknown";
};

export function workspaceAgentSessions(input: {
	bindings: ActiveBinding[];
	sessions: TerminalSession[];
	store: TerminalLayoutStore;
	workspaceId: string | null;
	ready: boolean;
	memberNames: Map<string, string>;
}): Map<string, WorkspaceAgentSession> {
	const sessions = new Map(
		terminalSessionRows(input.sessions, input.store, null).map((row) => [
			row.session.terminalId,
			row,
		]),
	);
	const rightIds = new Set(
		workspacePaneAreas(input.store)
			.right.getState()
			.tabs.flatMap((tab) => Object.values(tab.panes).map(paneTerminalId)),
	);
	const rows = input.bindings
		.filter((binding) => binding.endedAt == null)
		.map((binding) => {
			const current = input.ready && binding.workspaceId === input.workspaceId;
			const row = current ? sessions.get(binding.terminalId) : undefined;
			const explicitTitle =
				row && (row.session.customTitle || row.title !== row.session.title)
					? row.title
					: undefined;
			const named =
				explicitTitle?.trim() ||
				input.memberNames.get(binding.terminalId)?.trim() ||
				row?.title?.trim();
			const name =
				named || `${binding.agentId} · ${binding.terminalId.slice(0, 8)}`;
			return {
				terminalId: binding.terminalId,
				name: name.replace(/\s+/g, " ").slice(0, 120),
				provider: binding.agentId,
				location:
					!current || !row
						? "unknown"
						: rightIds.has(binding.terminalId)
							? "right"
							: row.attached
								? "tab"
								: "background",
			} satisfies WorkspaceAgentSession;
		});
	const counts = new Map<string, number>();
	for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
	return new Map(
		rows.map((row) => [
			row.terminalId,
			{
				...row,
				name:
					(counts.get(row.name) ?? 0) > 1
						? `${row.name} · ${row.terminalId.slice(0, 8)}`
						: row.name,
			},
		]),
	);
}
