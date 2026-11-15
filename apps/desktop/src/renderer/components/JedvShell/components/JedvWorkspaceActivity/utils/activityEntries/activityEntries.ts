import type { AgentIslandEntry } from "shared/types/agent-island";
export function activityEntries(
	hostUrl: string,
	workspaceId: string,
	entries: readonly AgentIslandEntry[],
): AgentIslandEntry[] {
	const unique = new Map<string, AgentIslandEntry>();
	for (const entry of entries.slice(0, 128)) {
		if (entry.workspaceId !== workspaceId) continue;
		const id = JSON.stringify([
			hostUrl,
			workspaceId,
			entry.provider,
			entry.profileHash,
			entry.nativeSessionId ?? entry.terminalId ?? entry.entryId,
		]);
		const previous = unique.get(id);
		if (
			!previous ||
			entry.leaseEpoch > previous.leaseEpoch ||
			(entry.leaseEpoch === previous.leaseEpoch &&
				attentionRank(entry) < attentionRank(previous))
		)
			unique.set(id, entry);
	}
	return [...unique.values()].sort(
		(a, b) => attentionRank(a) - attentionRank(b),
	);
}
function attentionRank(entry: AgentIslandEntry): number {
	return entry.pendingApprovals.length ||
		entry.turnState === "awaiting-approval"
		? 0
		: entry.completedUnread
			? 1
			: entry.turnState === "running"
				? 2
				: 3;
}
export function needsAttention(entry: AgentIslandEntry): boolean {
	return (
		!!entry.pendingApprovals.length ||
		entry.turnState === "awaiting-approval" ||
		entry.completedUnread
	);
}

export function runningWorkCount(
	agents: readonly AgentIslandEntry[],
	background: readonly { terminalId: string }[],
) {
	const identities = new Set(
		background.map((entry) => `terminal:${entry.terminalId}`),
	);
	for (const entry of agents)
		if (entry.turnState === "running")
			identities.add(
				entry.terminalId
					? `terminal:${entry.terminalId}`
					: `native:${entry.provider}:${entry.profileHash}:${entry.nativeSessionId ?? entry.entryId}`,
			);
	return identities.size;
}
