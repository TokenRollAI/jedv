import { z } from "zod";
import { targetPeerSchema } from "./teamwork-peers";

export const TEAMWORK_PROTOCOL_VERSION = 1;
export const MAX_AUTO_NUDGE_HOPS = 8;
export const AUTO_NUDGE_WINDOW_MS = 60_000;
export const MAX_AUTO_NUDGES_PER_WINDOW = 8;
export const teamStatuses = [
	"active",
	"paused",
	"stopped",
	"archived",
] as const;
export const memberStatuses = [
	"spawning",
	"active",
	"stopped",
	"failed",
	"reconcile_required",
] as const;
export const nudgeStates = [
	"not_applicable",
	"pending",
	"inflight",
	"nudged",
	"uncertain_staged",
	"suppressed_hop_limit",
	"suppressed_budget",
	"skipped",
	"failed",
] as const;
export type TeamStatus = (typeof teamStatuses)[number];
export type TeamMemberStatus = (typeof memberStatuses)[number];
export type MailNudgeState = (typeof nudgeStates)[number];

const id = z.string().min(1).max(128);
export const teamworkActorSchema = z.object({
	workspaceId: id,
	terminalId: id,
	launchId: id.optional(),
});
export type TeamworkActor = z.infer<typeof teamworkActorSchema>;
export const teamSelectorSchema = z.object({
	teamId: id.optional(),
	actor: teamworkActorSchema.optional(),
});
export const teamStartSchema = z
	.object({
		operationId: id,
		workspaceId: id,
		agent: z.string().min(1).max(256),
		prompt: z
			.string()
			.min(1)
			.max(200_000)
			.refine((value) => value.trim().length > 0, "Task must not be blank"),
		model: z.string().optional(),
		effort: z.string().optional(),
		mode: z.string().optional(),
		name: z.string().trim().min(1).max(120).optional(),
		leaderName: z.string().trim().min(1).max(120).default("leader"),
	})
	.strict();
export type TeamStartInput = z.infer<typeof teamStartSchema>;
export const teamInitSchema = z.object({
	actor: teamworkActorSchema,
	name: z.string().trim().min(1).max(120),
	goal: z.string().max(32_000).default(""),
	leaderName: z.string().trim().min(1).max(120).default("leader"),
});
export const teamSpawnSchema = teamSelectorSchema
	.extend({
		name: z.string().trim().min(1).max(120),
		operationId: id,
		agent: z.string().min(1).max(256),
		prompt: z.string().max(200_000),
		model: z.string().optional(),
		effort: z.string().optional(),
		mode: z.string().optional(),
		workspaceId: id.optional(),
		projectId: id.optional(),
		newWorktree: z.boolean().default(false),
		branch: z.string().min(1).max(200).optional(),
		baseBranch: z.string().min(1).max(200).optional(),
	})
	.refine(
		(v) => !v.workspaceId || (!v.projectId && !v.newWorktree && !v.branch),
		{ message: "Choose an existing workspace or a new project worktree" },
	);
export type TeamSpawnInput = z.infer<typeof teamSpawnSchema>;
export const teamStopSchema = teamSelectorSchema.extend({
	member: id.optional(),
});
export const teamArchiveSchema = teamSelectorSchema.extend({
	stop: z.boolean().default(false),
});
export const teamRenameSchema = teamSelectorSchema.extend({
	name: z.string().trim().min(1).max(120),
});
export const mailSendSchema = teamSelectorSchema.extend({
	targetPeer: targetPeerSchema.optional(),
	to: z.string().min(1).max(128),
	type: z.string().min(1).max(80).default("message"),
	subject: z.string().max(1000).default(""),
	body: z.string().max(200_000).default(""),
	payload: z.record(z.string(), z.unknown()).optional(),
	dedupeKey: id,
	replyTo: id.optional(),
	wakeBatchId: id.optional(),
	threadId: id.optional(),
});
export type MailSendInput = z.infer<typeof mailSendSchema>;
export const mailInboxSchema = teamSelectorSchema.extend({
	member: id.optional(),
	includeAcked: z.boolean().default(false),
	limit: z.number().int().min(1).max(500).default(100),
	after: id.optional(),
});
export const mailDeliverySchema = teamSelectorSchema.extend({
	member: id.optional(),
	deliveryId: id,
});
export const mailWatchSchema = mailInboxSchema.extend({
	timeoutMs: z.number().int().min(0).max(30_000).default(25_000),
});

export interface TeamworkCapabilities {
	protocolVersion: number;
	localOnly: boolean;
	orderedHooks?: boolean;
	features?: { start?: boolean };
}
