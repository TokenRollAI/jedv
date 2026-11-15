import { Database } from "bun:sqlite";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp } from "../app";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { LocalGitCredentialProvider } from "../providers/git";
import { PskHostAuthProvider } from "../providers/host-auth";

export function createAutomationTestHost(home: string) {
	const prior = process.env.JEDV_HOME_DIR;
	process.env.JEDV_HOME_DIR = home;
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	const migrationsFolder = resolve(import.meta.dir, "../../drizzle");
	migrate(db, { migrationsFolder });
	const host = createApp({
		config: {
			organizationId: "jedv-local",
			dbPath: join(home, "host.db"),
			migrationsFolder,
			allowedOrigins: [],
		},
		db: db as unknown as HostDb,
		providers: {
			hostAuth: new PskHostAuthProvider("isolated-test-secret"),
			credentials: new LocalGitCredentialProvider(async () => ({})),
		},
		execGh: async () => {
			throw new Error("External commands are disabled in automation fixtures");
		},
	});
	return {
		db: db as unknown as HostDb,
		request: (path: string) =>
			host.app.fetch(
				new Request(`http://host.test/trpc/${path}`, {
					headers: { authorization: "Bearer isolated-test-secret" },
				}),
			),
		dispose: async () => {
			try {
				await host.dispose();
			} finally {
				sqlite.close();
				if (prior === undefined) delete process.env.JEDV_HOME_DIR;
				else process.env.JEDV_HOME_DIR = prior;
			}
		},
	};
}
