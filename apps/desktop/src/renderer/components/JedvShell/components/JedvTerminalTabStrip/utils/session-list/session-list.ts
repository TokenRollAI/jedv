import type { TerminalSession } from "../../../../types";
import {
	paneTerminalId,
	type TerminalLayoutStore,
	workspaceAreaStores,
} from "../../../JedvTerminalWorkspace/layout";
import type { ResumeCandidate, SessionBinding } from "../../types";
export function terminalSessionRows(
	sessions: TerminalSession[],
	store: TerminalLayoutStore,
	activeId: string | null,
) {
	const titles = new Map<string, string>();
	const attached = new Set<string>();
	for (const tab of workspaceAreaStores(store).flatMap(
		(area) => area.getState().tabs,
	))
		for (const pane of Object.values(tab.panes)) {
			const id = paneTerminalId(pane);
			if (!id) continue;
			attached.add(id);
			if (pane.titleOverride && !titles.has(id))
				titles.set(id, pane.titleOverride);
		}
	return [...sessions]
		.sort(
			(a, b) =>
				Number(b.terminalId === activeId) - Number(a.terminalId === activeId) ||
				b.createdAt - a.createdAt,
		)
		.map((session) => ({
			session,
			current: session.terminalId === activeId,
			attached: attached.has(session.terminalId),
			title:
				titles.get(session.terminalId) || session.customTitle || session.title,
		}));
}
export type SessionContinuation =
	| { kind: "live"; binding: SessionBinding }
	| { kind: "resume"; candidate: ResumeCandidate };
export function sessionContinuation(
	session: TerminalSession,
	bindings: SessionBinding[],
	candidates: ResumeCandidate[],
): SessionContinuation | null {
	const binding = bindings.find(
		(row) =>
			row.terminalId === session.terminalId &&
			row.workspaceId === session.workspaceId &&
			row.endedAt == null &&
			(row.agentSessionId || row.chatSessionId),
	);
	if (!session.exited && binding) return { kind: "live", binding };
	const candidate = candidates.find(
		(row) => row.terminalId === session.terminalId && row.resumeSupported,
	);
	return candidate ? { kind: "resume", candidate } : null;
}
