import { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_SCHEMA_SQL } from "../db/memory-schema";
import { MemoryService } from "./service";
export function memoryFixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "jedv-memory-")));
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys=ON");
	db.exec(MEMORY_SCHEMA_SQL);
	const archived = new Set<string>();
	let now = 100;
	const service = new MemoryService(db, {
		now: () => ++now,
		isTeamArchived: (id) => archived.has(id),
		projectRoot: () => root,
	});
	return {
		root,
		db,
		service,
		archived,
		async dispose() {
			db.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
