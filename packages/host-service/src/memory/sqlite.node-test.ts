import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { MEMORY_SCHEMA_SQL } from "../db/memory-schema";
import { MemoryService } from "./service";

test("production better-sqlite3 FTS5, TS tokenization, triggers and transactional supersede", () => {
	const db = new Database(":memory:");
	try {
		db.exec("PRAGMA foreign_keys=ON");
		db.exec(MEMORY_SCHEMA_SQL);
		const service = new MemoryService(db, {
			projectRoot: () => {
				throw new Error("unused");
			},
			isTeamArchived: () => false,
		});
		const first = service.put({
			scopeKind: "global",
			title: "幂等 mail",
			content: "可信唤醒旧规则",
		});
		assert.equal(service.search({ query: "幂等 mail" }).length, 1);
		const second = service.put({
			scopeKind: "global",
			title: "幂等 mail",
			content: "可信投递新规则",
			supersedeId: first.id,
		});
		assert.equal(service.get(first.id).supersededById, second.id);
		assert.equal(service.search({ query: "唤醒" }).length, 0);
		assert.equal(service.search({ query: "投递" }).length, 1);
		service.remove(second.id);
		assert.equal(service.search({ query: "投递" }).length, 0);
		db.prepare("DELETE FROM memories WHERE id=?").run(first.id);
		db.prepare(
			"INSERT INTO memories_fts(memories_fts,rank) VALUES('integrity-check',1)",
		).run();
		assert.ok(Number(process.versions.modules) >= 149);
		console.log(
			`SQLite compatibility verified: Node ${process.versions.node}, ABI ${process.versions.modules}`,
		);
	} finally {
		db.close();
	}
});
