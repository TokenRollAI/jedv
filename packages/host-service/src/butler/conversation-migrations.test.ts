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

test("0047 upgrades preserve every legacy message/thread/turn without guessing audit classification", () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-conversation-upgrade-")),
		old = join(root, "old"),
		folder = resolve(import.meta.dir, "../../drizzle");
	mkdirSync(join(old, "meta"), { recursive: true });
	const journal = JSON.parse(
		readFileSync(join(folder, "meta/_journal.json"), "utf8"),
	);
	const entries = journal.entries.filter(
		(row: { idx: number }) => row.idx <= 47,
	) as { tag: string }[];
	writeFileSync(
		join(old, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries }),
	);
	for (const row of entries)
		copyFileSync(join(folder, `${row.tag}.sql`), join(old, `${row.tag}.sql`));
	const sqlite = new Database(join(root, "host.db")),
		db = drizzle(sqlite);
	try {
		migrate(db, { migrationsFolder: old });
		sqlite
			.prepare(
				"INSERT INTO butler_threads(id,title,created_at,updated_at) VALUES('qa','Approval-looking title; do not reclassify',1,20)",
			)
			.run();
		sqlite
			.prepare(
				"INSERT INTO butler_turns(id,thread_id,human_text,status,result_json,created_at) VALUES('legacy','qa','  old human\n text','completed','{}',1)",
			)
			.run();
		for (let i = 0; i < 14; i++)
			sqlite
				.prepare(
					"INSERT INTO butler_messages(id,thread_id,request_id,role,content,created_at) VALUES(?,'qa','legacy',?,?,?)",
				)
				.run(
					`message-${i}`,
					i % 2 ? "assistant" : "human",
					`  原文 ${i}\n    exact\t `,
					i,
				);
		const before = sqlite
			.prepare("SELECT * FROM butler_messages ORDER BY rowid")
			.all();
		migrate(db, { migrationsFolder: folder });
		migrate(db, { migrationsFolder: folder });
		expect(
			sqlite.prepare("SELECT * FROM butler_messages ORDER BY rowid").all(),
		).toEqual(before);
		expect(
			sqlite.prepare("SELECT id,title,kind FROM butler_threads").all(),
		).toEqual([
			{
				id: "qa",
				title: "Approval-looking title; do not reclassify",
				kind: "conversation",
			},
		]);
		expect(
			sqlite
				.prepare(
					"SELECT new_topic AS newTopic,context_json AS contextJson FROM butler_turns",
				)
				.all(),
		).toEqual([{ newTopic: 0, contextJson: null }]);
		expect(sqlite.prepare("SELECT * FROM butler_state").all()).toEqual([]);
		expect(() =>
			sqlite.prepare("INSERT INTO butler_state VALUES(2,NULL,1,1)").run(),
		).toThrow("CHECK");
		expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
});
