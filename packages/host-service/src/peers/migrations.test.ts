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
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

test("0044 profile upgrades through network and global Team start indexes without changing legacy data or init identities", () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-network-upgrade-")),
		old = join(root, "old");
	mkdirSync(join(old, "meta"), { recursive: true });
	const migrations = resolve(import.meta.dir, "../../drizzle");
	const journal = JSON.parse(
		readFileSync(join(migrations, "meta/_journal.json"), "utf8"),
	);
	const entries = journal.entries.filter(
		(entry: { idx: number }) => entry.idx <= 44,
	) as Array<{ idx: number; tag: string }>;
	writeFileSync(
		join(old, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries }),
	);
	for (const entry of entries)
		copyFileSync(
			join(migrations, `${entry.tag}.sql`),
			join(old, `${entry.tag}.sql`),
		);
	const sqlite = new Database(join(root, "host.db")),
		db = drizzle(sqlite);
	try {
		migrate(db, { migrationsFolder: old });
		sqlite.exec("PRAGMA foreign_keys=ON");
		for (const id of ["a", "b"]) {
			sqlite
				.prepare(
					"INSERT INTO teams(id,name,goal,status,created_at,updated_at) VALUES(?,?,?,'active',1,1)",
				)
				.run(id, id, "保留原始任务缩进\n  code");
			sqlite
				.prepare(
					"INSERT INTO team_members(id,team_id,name,role,status,operation_id,request_fingerprint,request_json,agent_id,task_summary,joined_at) VALUES(?,?,'leader','leader','active','init','legacy','{}','claude','original',1)",
				)
				.run(`leader-${id}`, id);
		}
		migrate(db, { migrationsFolder: migrations });
		migrate(db, { migrationsFolder: migrations });
		expect(
			sqlite
				.prepare(
					"SELECT count(*) AS n FROM team_members WHERE operation_id='init'",
				)
				.get(),
		).toEqual({ n: 2 });
		expect(sqlite.prepare("SELECT goal FROM teams WHERE id='a'").get()).toEqual(
			{ goal: "保留原始任务缩进\n  code" },
		);
		for (const table of [
			"peer_hosts",
			"mail_outbox",
			"mail_inbound_receipts",
			"mail_provider_tokens",
			"mobile_pairing_codes",
			"mobile_sessions",
			"mobile_settings",
		])
			expect(
				sqlite
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name=?",
					)
					.get(table),
			).toBeTruthy();
		const insert = sqlite.prepare(
			"INSERT INTO team_members(id,team_id,name,role,status,operation_id,request_fingerprint,request_json,agent_id,task_summary,joined_at) VALUES(?,?,'new-leader','leader','spawning','global-start','new','{}','claude','new task',2)",
		);
		insert.run("new-a", "a");
		expect(() => insert.run("new-b", "b")).toThrow("UNIQUE constraint failed");
		expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
});
