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

test("0046 profile upgrades additively through attention while preserving legacy alert facts and read state", () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-attention-upgrade-"));
	const old = join(root, "old"),
		migrations = resolve(import.meta.dir, "../../drizzle");
	mkdirSync(join(old, "meta"), { recursive: true });
	const journal = JSON.parse(
		readFileSync(join(migrations, "meta/_journal.json"), "utf8"),
	);
	const entries = journal.entries.filter(
		(entry: { idx: number }) => entry.idx <= 46,
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
		const insert = sqlite.prepare(
			"INSERT INTO watchdog_alerts(id,dedupe_key,kind,subject,body,team_id,created_at,read_at,delivered_at) VALUES(?,?,?,'Legacy subject','Legacy body','old-team',10,?,30)",
		);
		insert.run("old-read", "legacy-read", "mail_unacked", 20);
		insert.run("old-unread", "legacy-unread", "automation_failed", null);
		const before = sqlite
			.prepare("SELECT * FROM watchdog_alerts ORDER BY id")
			.all();
		migrate(db, { migrationsFolder: migrations });
		migrate(db, { migrationsFolder: migrations });
		const rows = sqlite
			.prepare("SELECT * FROM watchdog_alerts ORDER BY id")
			.all() as Array<Record<string, unknown>>;
		expect(rows).toHaveLength(2);
		for (const [index, row] of rows.entries()) {
			expect(row).toMatchObject(before[index] as Record<string, unknown>);
			expect(row).toMatchObject({
				group_key: null,
				severity: "normal",
				project_id: null,
				workspace_id: null,
				terminal_id: null,
				member_id: null,
				mail_delivery_id: null,
				automation_id: null,
				automation_run_id: null,
				ignored_at: null,
				ignore_reason: null,
				resolved_at: null,
			});
		}
		expect(
			sqlite
				.prepare(
					"SELECT COALESCE(group_key,dedupe_key) AS groupKey FROM watchdog_alerts WHERE id='old-read'",
				)
				.get(),
		).toEqual({ groupKey: "legacy-read" });
		const indexes = sqlite
			.prepare("PRAGMA index_list(watchdog_alerts)")
			.all() as Array<{ name: string }>;
		expect(indexes.map((index) => index.name)).toContain(
			"idx_watchdog_alerts_group",
		);
		expect(indexes.map((index) => index.name)).toContain(
			"idx_watchdog_alerts_state",
		);
		expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
});
