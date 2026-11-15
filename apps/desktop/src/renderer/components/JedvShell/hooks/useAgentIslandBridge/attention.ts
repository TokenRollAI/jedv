import type { AgentIslandEntry } from "shared/types/agent-island";
export function applyAttentionReadThrough(
	entries: readonly AgentIslandEntry[],
	published: readonly AgentIslandEntry[],
	floors: Record<string, number>,
	readEntryIds: readonly string[] = [],
): AgentIslandEntry[] {
	return entries.map((entry) => {
		const sent = published.find((item) => item.entryId === entry.entryId);
		if (
			!sent ||
			sent.nativeSessionId !== entry.nativeSessionId ||
			sent.profileHash !== entry.profileHash ||
			sent.leaseEpoch !== entry.leaseEpoch ||
			!entry.attention
		)
			return entry;
		const floor = Math.max(
			entry.attention.readThrough,
			floors[entry.entryId] ?? 0,
		);
		const unread =
			entry.completedUnread &&
			!readEntryIds.includes(entry.entryId) &&
			(entry.attention.event?.occurredAt ?? Number.MAX_SAFE_INTEGER) > floor;
		if (
			floor === entry.attention.readThrough &&
			unread === entry.completedUnread
		)
			return entry;
		return {
			...entry,
			completedUnread: unread,
			attention: { ...entry.attention, readThrough: floor },
		};
	});
}
