import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { workspacePresentationRouter } from "./workspace-presentation";

test("workspace presentation persists independently of tags and is scoped by user", async () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-workspace-view-"));
	let sqlite = new Database(join(root, "fixture.db"));
	try {
		let db = drizzle(sqlite, { schema });
		migrate(db, {
			migrationsFolder: resolve(import.meta.dir, "../../../../drizzle"),
		});
		db.insert(schema.workspaces)
			.values([
				{
					id: "a",
					worktreePath: "/fixture/a",
					branch: "main",
					type: "session",
				},
				{
					id: "b",
					worktreePath: "/fixture/b",
					branch: "main",
					type: "session",
				},
			])
			.run();
		const caller = (userId: string) =>
			workspacePresentationRouter.createCaller({
				db,
				userId,
				isAuthenticated: true,
			} as unknown as HostServiceContext);
		await caller("one").setPinned({ workspaceId: "a", pinned: true });
		await caller("one").reorder({ projectId: null, workspaceIds: ["b", "a"] });
		expect(await caller("two").list()).toEqual([]);
		sqlite.close();
		sqlite = new Database(join(root, "fixture.db"));
		db = drizzle(sqlite, { schema });
		expect(
			(await caller("one").list()).sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0),
			),
		).toEqual([
			{ workspaceId: "b", position: 0, pinned: false },
			{ workspaceId: "a", position: 1, pinned: true },
		]);
		expect(db.select().from(schema.workspaceTags).all()).toEqual([]);
		db.update(schema.workspaces)
			.set({ archivedAt: 1 })
			.where(eq(schema.workspaces.id, "a"))
			.run();
		expect(await caller("one").list()).toEqual([
			{ workspaceId: "b", position: 0, pinned: false },
		]);
		sqlite.exec("PRAGMA foreign_keys = ON");
		db.delete(schema.workspaces).where(eq(schema.workspaces.id, "a")).run();
		expect(db.select().from(schema.workspacePresentation).all()).toHaveLength(
			1,
		);
	} finally {
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("stale or partial reorders fail before changing persisted positions", async () => {
	const sqlite = new Database(":memory:");
	try {
		const db = drizzle(sqlite, { schema });
		migrate(db, {
			migrationsFolder: resolve(import.meta.dir, "../../../../drizzle"),
		});
		db.insert(schema.workspaces)
			.values([
				{ id: "a", worktreePath: "/fixture/a", branch: "main" },
				{ id: "b", worktreePath: "/fixture/b", branch: "main" },
			])
			.run();
		const caller = workspacePresentationRouter.createCaller({
			db,
			isAuthenticated: true,
		} as unknown as HostServiceContext);
		await expect(
			caller.reorder({ projectId: null, workspaceIds: ["a"] }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			caller.reorder({ projectId: null, workspaceIds: ["a", "a"] }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await caller.list()).toEqual([]);
		await expect(
			caller.setPinned({ workspaceId: "missing", pinned: true }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	} finally {
		sqlite.close();
	}
});
