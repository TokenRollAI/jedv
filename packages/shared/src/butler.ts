import { z } from "zod";
import type {
	AttentionGroupShape,
	AttentionSourceTarget,
	ButlerBadgeSummary,
} from "./butler-attention";

const id = z.string().min(1).max(128);
export const butlerTurnContextSchema = z
	.object({
		alertId: id.optional(),
		groupKey: z.string().min(1).max(1000).optional(),
		approvalId: id.optional(),
		teamId: id.optional(),
		workspaceId: id.optional(),
	})
	.strict();
export type ButlerTurnContext = z.infer<typeof butlerTurnContextSchema>;
export const butlerStateQuerySchema = z
	.object({ preferredThreadId: id.optional() })
	.default({});
export const butlerThreadListSchema = z
	.object({
		limit: z.number().int().min(1).max(100).default(50),
		includeAudit: z.boolean().default(false),
	})
	.default({ limit: 50, includeAudit: false });
export const butlerSendSchema = z
	.object({
		threadId: id.optional(),
		newTopic: z.boolean().default(false),
		preferredThreadId: id.optional(),
		context: butlerTurnContextSchema.optional(),
		requestId: id.optional(),
		humanText: z
			.string()
			.min(1)
			.max(12000)
			.refine((text) => text.trim().length > 0),
	})
	.refine(
		(x) => !(x.newTopic && x.threadId),
		"newTopic cannot specify threadId",
	);
export const butlerHistorySchema = z.object({
	requestId: id.optional(),
	threadId: id.optional(),
	limit: z.number().int().min(1).max(200).default(100),
	before: z.number().optional(),
	beforeId: id.optional(),
});
export const butlerApprovalListSchema = z
	.object({
		status: z.enum(["pending", "history", "all"]).default("pending"),
		threadId: id.optional(),
		approvalId: id.optional(),
		limit: z.number().int().min(1).max(200).default(100),
	})
	.default({ status: "pending", limit: 100 });
export const butlerResolveSchema = z.object({
	approvalId: id,
	payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
	decision: z.enum(["approve", "reject"]),
});
export const guardedActionSchema = z.discriminatedUnion("actionType", [
	z.object({ actionType: z.literal("archiveWorkspace"), workspaceId: id }),
	z.object({
		actionType: z.literal("stopTeam"),
		teamId: id,
		member: id.optional(),
	}),
	z.object({
		actionType: z.literal("deleteMemoryBatch"),
		memoryIds: z.array(id).min(1).max(100),
	}),
	z.object({
		actionType: z.literal("acceptGlobalMemory"),
		memoryId: id,
		supersedeId: id.optional(),
	}),
]);
export type GuardedAction = z.infer<typeof guardedActionSchema>;
export const butlerRequestApprovalSchema = z
	.object({
		requestId: id,
		threadId: id.optional(),
		humanText: z
			.string()
			.min(1)
			.max(12000)
			.refine((text) => text.trim().length > 0),
		action: guardedActionSchema,
	})
	.strict();
export type ButlerApprovalStatus =
	| "pending"
	| "claimed"
	| "executed"
	| "rejected"
	| "expired"
	| "failed";
export interface ButlerApprovalShape {
	id: string;
	threadId: string;
	actionType: GuardedAction["actionType"];
	targetId: string;
	summary: string;
	payload: GuardedAction;
	payloadHash: string;
	status: ButlerApprovalStatus;
	createdAt: number;
	expiresAt: number;
	resolvedAt: number | null;
	error: string | null;
	source?: AttentionSourceTarget;
}
export interface ButlerThreadShape {
	id: string;
	kind: "conversation" | "approval_audit";
	title: string;
	createdAt: number;
	updatedAt: number;
}
export interface ButlerConversationStateShape {
	currentThreadId: string | null;
	thread: ButlerThreadShape | null;
}
export interface ButlerAttentionShape {
	badge: ButlerBadgeSummary;
	groups: AttentionGroupShape[];
	approvals: ButlerApprovalShape[];
}
export interface ButlerMessageShape {
	id: string;
	threadId: string;
	requestId: string;
	role: "human" | "assistant" | "tool";
	content: string;
	createdAt: number;
	turnContext?: ButlerTurnContext | null;
}
export interface ButlerSendResult {
	threadId: string;
	currentThreadId: string | null;
	requestId: string;
	reply: string;
	approvals: ButlerApprovalShape[];
	degraded: boolean;
	reason: "no_key" | "unavailable" | "budget" | null;
}
