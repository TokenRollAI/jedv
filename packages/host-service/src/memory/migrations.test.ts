import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "@jedv/shared/sqlite-migrations";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { MemoryService } from "./service";

test("0043 upgrades an existing 0042 database without changing prior rows; FTS triggers survive reopen", () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-memory-upgrade-"));
	let db = new Database(join(root, "host.db"));
	try {
		const source = resolve(import.meta.dir, "../../drizzle");
		const prior = join(root, "prior");
		mkdirSync(join(prior, "meta"), { recursive: true });
		const journal = JSON.parse(
			readFileSync(join(source, "meta/_journal.json"), "utf8"),
		);
		const entries = journal.entries.filter(
			(entry: { idx: number }) => entry.idx <= 42,
		);
		writeFileSync(
			join(prior, "meta/_journal.json"),
			JSON.stringify({ ...journal, entries }),
		);
		for (const entry of entries)
			copyFileSync(
				join(source, entry.tag + ".sql"),
				join(prior, entry.tag + ".sql"),
			);
		runMigrations(drizzle(db), prior);
		db.prepare(
			"INSERT INTO projects(id,name,repo_path,created_at,updated_at) VALUES(?,?,?,?,?)",
		).run("p", "preserved", root, 1, 1);
		runMigrations(drizzle(db), source);
		runMigrations(drizzle(db), source);
		expect(db.prepare("SELECT name FROM projects WHERE id='p'").get()).toEqual({
			name: "preserved",
		});
		const service = new MemoryService(db, {
			projectRoot: () => root,
			isTeamArchived: () => false,
		});
		service.put({
			scopeKind: "project",
			scopeId: "p",
			title: "幂等",
			content: "中英 Mail searchable",
		});
		db.close();
		db = new Database(join(root, "host.db"));
		const reopened = new MemoryService(db, {
			projectRoot: () => root,
			isTeamArchived: () => false,
		});
		expect(reopened.search({ query: "幂等 Mail" })).toHaveLength(1);
		db.prepare(
			"INSERT INTO memories_fts(memories_fts,rank) VALUES('integrity-check',1)",
		).run();
		expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		db.close();
		rmSync(root, { recursive: true, force: true });
	}
});
