import { z } from "zod";

export const automationTargetSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("workspace"), workspaceId: z.string().min(1) })
		.strict(),
	z
		.object({
			kind: z.literal("project"),
			projectId: z.string().min(1),
			baseBranch: z.string().min(1).optional(),
		})
		.strict(),
]);
const automationFieldsSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		prompt: z.string().trim().min(1).max(100_000),
		agent: z.enum(["claude", "codex", "agy", "kimi"]),
		agentConfigId: z.string().min(1).optional(),
		target: automationTargetSchema,
		enabled: z.boolean(),
		rrule: z.string().trim().min(1).max(2000).nullable(),
		timezone: z.string().min(1),
	})
	.strict();
export const automationInputSchema = automationFieldsSchema.extend({
	enabled: z.boolean().default(true),
	rrule: automationFieldsSchema.shape.rrule.default(null),
	timezone: z.string().min(1).default("UTC"),
});
export const automationPatchSchema = automationFieldsSchema
	.partial()
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one field is required",
	);
export const automationSchema = automationInputSchema
	.extend({
		id: z.string().uuid(),
		createdAt: z.number(),
		updatedAt: z.number(),
		nextRunAt: z.number().nullable(),
	})
	.strict();
export const runStatusSchema = z.enum([
	"starting",
	"running",
	"awaiting-approval",
	"succeeded",
	"failed",
	"interrupted",
]);
export const automationRunSchema = z
	.object({
		id: z.string().uuid(),
		automationId: z.string().uuid(),
		trigger: z.enum(["manual", "schedule"]),
		scheduledAt: z.number().nullable(),
		status: runStatusSchema,
		createdAt: z.number(),
		updatedAt: z.number(),
		finishedAt: z.number().nullable(),
		workspaceId: z.string().nullable(),
		terminalId: z.string().nullable(),
		chatSessionId: z.string().nullable(),
		nativeSessionId: z.string().nullable(),
		error: z.string().nullable(),
	})
	.strict();
export const automationFileSchema = z
	.object({
		version: z.literal(1),
		definitions: z.array(automationSchema).max(1000),
		runs: z.array(automationRunSchema).max(50_000),
	})
	.strict()
	.superRefine((value, ctx) => {
		const ids = new Set<string>();
		for (const definition of value.definitions) {
			if (ids.has(definition.id))
				ctx.addIssue({ code: "custom", message: "Duplicate automation id" });
			ids.add(definition.id);
		}
		const counts = new Map<string, number>();
		const runIds = new Set<string>();
		for (const run of value.runs) {
			const count = (counts.get(run.automationId) ?? 0) + 1;
			counts.set(run.automationId, count);
			if (!ids.has(run.automationId) || count > 50 || runIds.has(run.id))
				ctx.addIssue({
					code: "custom",
					message: "Invalid automation run ownership or retention",
				});
			runIds.add(run.id);
		}
	});
export type AutomationInput = z.input<typeof automationInputSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationFile = z.infer<typeof automationFileSchema>;
export type RunUpdate = Partial<
	Pick<
		AutomationRun,
		| "status"
		| "workspaceId"
		| "terminalId"
		| "chatSessionId"
		| "nativeSessionId"
	>
>;
export const isActiveRun = (run: AutomationRun) =>
	["starting", "running", "awaiting-approval"].includes(run.status);
