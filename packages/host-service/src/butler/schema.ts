import { desc, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const butlerThreads = sqliteTable(
	"butler_threads",
	{
		id: text("id").primaryKey(),
		title: text("title").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		kind: text("kind").notNull().default("conversation"),
	},
	(t) => [
		index("idx_butler_threads_kind_updated").on(t.kind, desc(t.updatedAt)),
	],
);
export const butlerState = sqliteTable(
	"butler_state",
	{
		id: integer("id").primaryKey(),
		currentThreadId: text("current_thread_id").references(
			() => butlerThreads.id,
		),
		initializedAt: integer("initialized_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [check("butler_state_singleton", sql`${t.id} = 1`)],
);
export const butlerMessages = sqliteTable(
	"butler_messages",
	{
		id: text("id").primaryKey(),
		threadId: text("thread_id")
			.notNull()
			.references(() => butlerThreads.id),
		requestId: text("request_id").notNull(),
		role: text("role").notNull(),
		content: text("content").notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [index("butler_messages_thread_created").on(t.threadId, t.createdAt)],
);
export const butlerTurns = sqliteTable(
	"butler_turns",
	{
		id: text("id").primaryKey(),
		threadId: text("thread_id")
			.notNull()
			.references(() => butlerThreads.id),
		humanText: text("human_text").notNull(),
		status: text("status").notNull(),
		resultJson: text("result_json"),
		createdAt: integer("created_at").notNull(),
		newTopic: integer("new_topic", { mode: "boolean" })
			.notNull()
			.default(false),
		contextJson: text("context_json"),
	},
	(t) => [uniqueIndex("butler_turns_request").on(t.id)],
);
export const butlerApprovals = sqliteTable(
	"butler_approvals",
	{
		id: text("id").primaryKey(),
		threadId: text("thread_id")
			.notNull()
			.references(() => butlerThreads.id),
		requestId: text("request_id").notNull(),
		actionType: text("action_type").notNull(),
		targetId: text("target_id").notNull(),
		summary: text("summary").notNull(),
		canonicalPayloadJson: text("canonical_payload_json").notNull(),
		payloadHash: text("payload_hash").notNull(),
		targetStateHash: text("target_state_hash").notNull(),
		status: text("status").notNull(),
		createdAt: integer("created_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		resolvedAt: integer("resolved_at"),
		error: text("error"),
	},
	(t) => [
		index("butler_approvals_status_expiry").on(t.status, t.expiresAt),
		index("idx_butler_approvals_thread_created").on(
			t.threadId,
			desc(t.createdAt),
		),
	],
);
