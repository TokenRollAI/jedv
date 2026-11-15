CREATE TABLE IF NOT EXISTS memories (
 id TEXT PRIMARY KEY NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','project','team')), scope_id TEXT NOT NULL DEFAULT '',
 tier TEXT NOT NULL CHECK(tier IN ('core','archival')), category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
 source_kind TEXT NOT NULL, source_ref TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','candidate','rejected','removed')),
 superseded_by_id TEXT REFERENCES memories(id), content_hash TEXT NOT NULL, search_tokens TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((scope_kind = 'global' AND scope_id = '') OR (scope_kind != 'global' AND length(scope_id) > 0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_memories_scope_tier ON memories(scope_kind,scope_id,tier);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(scope_kind,scope_id,content_hash);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(search_tokens, content='memories', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
 INSERT INTO memories_fts(rowid,search_tokens) VALUES(new.rowid,new.search_tokens); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
 INSERT INTO memories_fts(memories_fts,rowid,search_tokens) VALUES('delete',old.rowid,old.search_tokens); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
 INSERT INTO memories_fts(memories_fts,rowid,search_tokens) VALUES('delete',old.rowid,old.search_tokens);
 INSERT INTO memories_fts(rowid,search_tokens) VALUES(new.rowid,new.search_tokens); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS watchdog_alerts (
 id TEXT PRIMARY KEY NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 team_id TEXT, created_at INTEGER NOT NULL, read_at INTEGER, delivered_at INTEGER
);
