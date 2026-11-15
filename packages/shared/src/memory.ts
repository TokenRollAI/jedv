import { z } from "zod";

export const memoryScopeKindSchema = z.enum(["global", "project", "team"]);
export const memoryTierSchema = z.enum(["core", "archival"]);
export const memoryCategorySchema = z.enum([
	"correction",
	"convention",
	"pitfall",
	"context",
	"summary",
]);
export const memoryScopeSchema = z
	.object({
		scopeKind: memoryScopeKindSchema,
		scopeId: z.string().max(200).default(""),
	})
	.refine(
		(x) => (x.scopeKind === "global" ? x.scopeId === "" : x.scopeId.length > 0),
		"Non-global scopes require an ID; global scope ID must be empty",
	);
export const memoryListSchema = memoryScopeSchema.safeExtend({
	tier: memoryTierSchema.optional(),
	includeCandidates: z.boolean().default(false),
	includeHistory: z.boolean().default(false),
	limit: z.number().int().min(1).max(500).default(100),
});
export const memoryPutSchema = memoryScopeSchema.safeExtend({
	title: z.string().trim().min(1).max(300),
	content: z.string().trim().min(1).max(32000),
	tier: memoryTierSchema.default("core"),
	category: memoryCategorySchema.default("context"),
	sourceKind: z.enum(["human", "agent"]).default("human"),
	sourceRef: z.string().max(500).optional(),
	supersedeId: z.string().optional(),
});
export const memorySearchSchema = z
	.object({
		query: z.string().trim().min(1).max(500),
		scopeKind: memoryScopeKindSchema.optional(),
		scopeId: z.string().max(200).optional(),
		limit: z.number().int().min(1).max(100).default(10),
	})
	.refine(
		(x) =>
			x.scopeKind
				? x.scopeKind === "global"
					? !x.scopeId
					: !!x.scopeId
				: !x.scopeId,
		"Search scope ID must match scope kind",
	);
export const memoryReviewSchema = z.object({
	id: z.string().min(1),
	action: z.enum(["accept", "reject"]),
	supersedeId: z.string().optional(),
});
export const memoryProjectFileSchema = z.object({
	projectId: z.string().min(1),
	filePath: z.string().optional(),
});
export const memoryTransferEntrySchema = z.object({
	title: z.string().trim().min(1).max(300),
	content: z.string().trim().min(1).max(32000),
	tier: memoryTierSchema,
	category: memoryCategorySchema,
	sourceKind: z.enum(["human", "agent", "watchdog", "butler"]),
	sourceRef: z.string().max(500).nullable().optional(),
});
export const memoryTransferSchema = z.object({
	version: z.literal(1),
	entries: z.array(memoryTransferEntrySchema).max(1000),
});
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryPut = z.input<typeof memoryPutSchema>;
export interface MemoryItemShape extends MemoryScope {
	id: string;
	title: string;
	content: string;
	tier: z.infer<typeof memoryTierSchema>;
	category: z.infer<typeof memoryCategorySchema>;
	sourceKind: "human" | "agent" | "watchdog" | "butler";
	sourceRef: string | null;
	status: "active" | "candidate" | "rejected" | "removed";
	supersededById: string | null;
	createdAt: number;
	updatedAt: number;
}
export interface WatchdogAlertShape {
	id: string;
	dedupeKey: string;
	kind:
		| "suspected_stalled"
		| "mail_unacked"
		| "automation_failed"
		| "team_attention";
	subject: string;
	body: string;
	teamId: string | null;
	createdAt: number;
	readAt: number | null;
}

export interface MemoryClientShape {
	memory: {
		capabilities: { query(): Promise<{ protocolVersion: number }> };
		list: {
			query(
				input: z.input<typeof memoryListSchema>,
			): Promise<MemoryItemShape[]>;
		};
		search: {
			query(
				input: z.input<typeof memorySearchSchema>,
			): Promise<MemoryItemShape[]>;
		};
		put: {
			mutate(input: z.input<typeof memoryPutSchema>): Promise<MemoryItemShape>;
		};
		remove: { mutate(input: { id: string }): Promise<MemoryItemShape> };
		reviewCandidate: {
			mutate(
				input: z.input<typeof memoryReviewSchema>,
			): Promise<MemoryItemShape>;
		};
		exportData: {
			query(input: MemoryScope): Promise<z.infer<typeof memoryTransferSchema>>;
		};
		importData: {
			mutate(input: {
				scope: MemoryScope;
				data: z.infer<typeof memoryTransferSchema>;
			}): Promise<MemoryItemShape[]>;
		};
		exportProject: {
			mutate(input: {
				projectId: string;
				filePath?: string;
			}): Promise<{ filePath: string; count: number }>;
		};
		importProject: {
			mutate(input: {
				projectId: string;
				filePath: string;
			}): Promise<MemoryItemShape[]>;
		};
	};
}
