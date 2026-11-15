import type { AgentIslandEntry } from "shared/types/agent-island";
import type { NativeState, Project, Workspace } from "../../types";

export const isIslandProvider = (
	value: string,
): value is AgentIslandEntry["provider"] =>
	["codex", "claude", "agy", "kimi"].includes(value);
export function islandPriority(
	entry: Pick<
		AgentIslandEntry,
		"pendingApprovals" | "turnState" | "completedUnread"
	>,
): number {
	return entry.pendingApprovals.length ||
		entry.turnState === "awaiting-approval"
		? 0
		: entry.turnState === "running"
			? 1
			: entry.completedUnread
				? 2
				: 3;
}
export function snapshotEntry(input: {
	entryId: string;
	state: Pick<
		NativeState,
		| "provider"
		| "nativeSessionId"
		| "profileHash"
		| "terminalId"
		| "activeWriter"
		| "leaseEpoch"
		| "turnState"
		| "pendingApprovals"
	>;
	workspace: Workspace;
	project?: Project;
	agentConfigId?: string;
	previous?: AgentIslandEntry;
	event?: NonNullable<AgentIslandEntry["attention"]>["event"];
}): AgentIslandEntry {
	const { state, workspace } = input;
	const candidate = input.previous;
	const previous =
		candidate?.nativeSessionId === state.nativeSessionId &&
		candidate.provider === state.provider &&
		candidate.profileHash === state.profileHash &&
		candidate.workspaceId === workspace.id
			? candidate
			: undefined;
	const sourceEvent = input.event ?? null;
	const readThrough = previous?.attention?.readThrough ?? 0;
	const changed =
		!!previous?.attention &&
		!!sourceEvent &&
		sourceEvent.occurredAt > previous.attention.observedAt;
	const retained =
		previous?.completedUnread &&
		previous.attention?.event?.kind === "completed" &&
		previous.attention.event.occurredAt > readThrough
			? previous.attention.event
			: null;
	const event =
		sourceEvent?.kind === "completed" ? sourceEvent : (retained ?? sourceEvent);
	const verifiedUnread =
		!!event &&
		event.kind === "completed" &&
		event.occurredAt > readThrough &&
		(changed || !!retained);
	const unmarkedUnread =
		!sourceEvent &&
		previous?.leaseEpoch === state.leaseEpoch &&
		((previous?.turnState === "running" && state.turnState === "idle") ||
			(!!previous?.completedUnread && previous.attention?.event === null));
	const completedUnread = verifiedUnread || unmarkedUnread;
	return {
		entryId: input.entryId,
		workspaceId: workspace.id,
		workspaceName: (workspace.name || workspace.branch).slice(0, 160),
		projectName: (input.project?.name ?? "").slice(0, 160),
		provider: state.provider,
		nativeSessionId: state.nativeSessionId,
		profileHash: state.profileHash,
		agentConfigId: input.agentConfigId,
		terminalId: state.terminalId,
		activeWriter: state.activeWriter,
		leaseEpoch: state.leaseEpoch,
		turnState: state.turnState,
		completedUnread,
		attention: {
			event,
			observedAt:
				sourceEvent?.occurredAt ?? previous?.attention?.observedAt ?? 0,
			readThrough,
		},
		pendingApprovals: state.pendingApprovals.slice(0, 8),
	};
}

export function bindingAttentionEvent(
	binding:
		| {
				agentId: string;
				agentSessionId?: string | null;
				lastEventType: string;
				lastEventAt: number;
		  }
		| undefined,
	provider: string,
	nativeSessionId: string | null,
): NonNullable<AgentIslandEntry["attention"]>["event"] {
	if (
		!binding ||
		!nativeSessionId ||
		binding.agentId !== provider ||
		binding.agentSessionId !== nativeSessionId ||
		!Number.isSafeInteger(binding.lastEventAt) ||
		binding.lastEventAt <= 0
	)
		return null;
	return {
		marker: `${binding.lastEventType}:${binding.lastEventAt}`,
		occurredAt: binding.lastEventAt,
		kind:
			binding.lastEventType === "Stop" || binding.lastEventType === "Failed"
				? "completed"
				: binding.lastEventType === "PermissionRequest" ||
						binding.lastEventType === "PendingQuestion"
					? "awaiting-response"
					: "other",
	};
}
