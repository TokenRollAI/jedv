import { z } from "zod";

const id = z.string().min(1).max(256);
export const agentIslandPreferencesSchema = z.strictObject({
	enabled: z.boolean(),
});
export type AgentIslandPreferences = z.infer<
	typeof agentIslandPreferencesSchema
>;
export const DEFAULT_AGENT_ISLAND_PREFERENCES: AgentIslandPreferences = {
	enabled: false,
};

export const agentIslandEntrySchema = z.strictObject({
	entryId: id,
	workspaceId: id,
	workspaceName: z.string().max(160),
	projectName: z.string().max(160),
	provider: z.enum(["codex", "claude", "agy", "kimi"]),
	nativeSessionId: id.nullable(),
	profileHash: id.nullable(),
	agentConfigId: id.optional(),
	terminalId: id.nullable(),
	activeWriter: z.enum(["cli", "control", "none"]),
	leaseEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	turnState: z.enum(["idle", "running", "awaiting-approval", "unknown"]),
	completedUnread: z.boolean(),
	attention: z
		.strictObject({
			event: z
				.strictObject({
					marker: id,
					occurredAt: z
						.number()
						.int()
						.nonnegative()
						.max(Number.MAX_SAFE_INTEGER),
					kind: z.enum(["completed", "awaiting-response", "other"]),
				})
				.nullable(),
			observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
			readThrough: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		})
		.optional(),
	summary: z.string().max(512).optional(),
	pendingApprovals: z
		.array(z.strictObject({ requestId: id, method: id }))
		.max(8),
});
export type AgentIslandEntry = z.infer<typeof agentIslandEntrySchema>;

export const agentIslandSnapshotSchema = z
	.strictObject({
		hostId: id,
		entries: z.array(agentIslandEntrySchema).max(32),
	})
	.superRefine(({ entries }, ctx) => {
		if (new Set(entries.map((entry) => entry.entryId)).size !== entries.length)
			ctx.addIssue({ code: "custom", message: "Duplicate Island entry" });
		for (const entry of entries) {
			if (
				new Set(entry.pendingApprovals.map((item) => item.requestId)).size !==
				entry.pendingApprovals.length
			)
				ctx.addIssue({ code: "custom", message: "Duplicate pending approval" });
		}
	});
export const agentIslandHostSchema = z.strictObject({ hostId: id });
export const agentIslandFocusSchema = z.strictObject({
	entryId: id,
	hostId: id,
});
export const agentIslandApprovalSchema = z.strictObject({
	entryId: id,
	hostId: id,
	profileHash: id,
	nativeSessionId: id,
	expectedLeaseEpoch: z
		.number()
		.int()
		.nonnegative()
		.max(Number.MAX_SAFE_INTEGER),
	requestId: id,
	decision: z.enum(["accept", "decline"]),
});
export type AgentIslandApprovalInput = z.infer<
	typeof agentIslandApprovalSchema
>;

export interface AgentIslandState {
	preferences: AgentIslandPreferences;
	binding: { hostId: string; windowId: number } | null;
	entries: AgentIslandEntry[];
	revision: number;
	visible: boolean;
	attentionBadge?: { count: number; dot: boolean; bounce: false };
	attentionReadThrough?: Record<string, number>;
	attentionReadEntryIds?: string[];
}

export interface AgentIslandFocusEvent {
	entryId: string;
	hostId: string;
	workspaceId: string;
	terminalId: string | null;
	nativeSessionId: string | null;
	provider: AgentIslandEntry["provider"];
}
export interface AgentIslandApprovalEvent {
	actionId: string;
	hostId: string;
	workspaceId: string;
	provider: AgentIslandEntry["provider"];
	agentConfigId?: string;
	nativeSessionId: string;
	profileHash: string;
	expectedLeaseEpoch: number;
	requestId: string;
	decision: "accept" | "decline";
}
export interface AgentIslandApprovalResultEvent {
	actionId: string;
	ok: boolean;
}
export const AGENT_ISLAND_EVENTS = {
	state: "agent-island:state",
	focusTerminal: "agent-island:focus-terminal",
	approval: "agent-island:approval",
	approvalResult: "agent-island:approval-result",
} as const;
