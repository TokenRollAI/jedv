import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const memories = sqliteTable(
	"memories",
	{
		id: text("id").primaryKey(),
		scopeKind: text("scope_kind").notNull(),
		scopeId: text("scope_id").notNull().default(""),
		tier: text("tier").notNull(),
		category: text("category").notNull(),
		title: text("title").notNull(),
		content: text("content").notNull(),
		sourceKind: text("source_kind").notNull(),
		sourceRef: text("source_ref"),
		status: text("status").notNull().default("active"),
		supersededById: text("superseded_by_id"),
		contentHash: text("content_hash").notNull(),
		searchTokens: text("search_tokens").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [
		index("idx_memories_scope_tier").on(t.scopeKind, t.scopeId, t.tier),
		index("idx_memories_hash").on(t.scopeKind, t.scopeId, t.contentHash),
	],
);
export const watchdogAlerts = sqliteTable(
	"watchdog_alerts",
	{
		id: text("id").primaryKey(),
		dedupeKey: text("dedupe_key").notNull().unique(),
		kind: text("kind").notNull(),
		subject: text("subject").notNull(),
		body: text("body").notNull(),
		teamId: text("team_id"),
		createdAt: integer("created_at").notNull(),
		readAt: integer("read_at"),
		deliveredAt: integer("delivered_at"),
		groupKey: text("group_key"),
		severity: text("severity").notNull().default("normal"),
		projectId: text("project_id"),
		workspaceId: text("workspace_id"),
		terminalId: text("terminal_id"),
		memberId: text("member_id"),
		mailDeliveryId: text("mail_delivery_id"),
		automationId: text("automation_id"),
		automationRunId: text("automation_run_id"),
		ignoredAt: integer("ignored_at"),
		ignoreReason: text("ignore_reason"),
		resolvedAt: integer("resolved_at"),
	},
	(t) => [
		index("idx_watchdog_alerts_group").on(t.groupKey, desc(t.createdAt)),
		index("idx_watchdog_alerts_state").on(
			t.resolvedAt,
			t.ignoredAt,
			t.readAt,
			t.severity,
		),
	],
);

// Fresh standalone fixtures include the additive Attention schema; Host upgrades use numbered migrations.
export const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
 id TEXT PRIMARY KEY NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','project','team')), scope_id TEXT NOT NULL DEFAULT '',
 tier TEXT NOT NULL CHECK(tier IN ('core','archival')), category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
 source_kind TEXT NOT NULL, source_ref TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','candidate','rejected','removed')),
 superseded_by_id TEXT REFERENCES memories(id), content_hash TEXT NOT NULL, search_tokens TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((scope_kind = 'global' AND scope_id = '') OR (scope_kind != 'global' AND length(scope_id) > 0))
);
CREATE INDEX IF NOT EXISTS idx_memories_scope_tier ON memories(scope_kind,scope_id,tier);
CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(scope_kind,scope_id,content_hash);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(search_tokens, content='memories', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
 INSERT INTO memories_fts(rowid,search_tokens) VALUES(new.rowid,new.search_tokens); END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
 INSERT INTO memories_fts(memories_fts,rowid,search_tokens) VALUES('delete',old.rowid,old.search_tokens); END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
 INSERT INTO memories_fts(memories_fts,rowid,search_tokens) VALUES('delete',old.rowid,old.search_tokens);
 INSERT INTO memories_fts(rowid,search_tokens) VALUES(new.rowid,new.search_tokens); END;
CREATE TABLE IF NOT EXISTS watchdog_alerts (
 id TEXT PRIMARY KEY NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 team_id TEXT, created_at INTEGER NOT NULL, read_at INTEGER, delivered_at INTEGER,
 group_key TEXT, severity TEXT NOT NULL DEFAULT 'normal', project_id TEXT, workspace_id TEXT, terminal_id TEXT,
 member_id TEXT, mail_delivery_id TEXT, automation_id TEXT, automation_run_id TEXT,
 ignored_at INTEGER, ignore_reason TEXT, resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_watchdog_alerts_group ON watchdog_alerts(group_key,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchdog_alerts_state ON watchdog_alerts(resolved_at,ignored_at,read_at,severity);`;
