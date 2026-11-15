import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../../db";
import * as schema from "../../../../db/schema";
import type { createTerminalSessionInternal } from "../../../../terminal/terminal";
import type { HostServiceContext } from "../../../../types";
import { workspacesRouter } from "../../workspaces/workspaces";
import {
	getWorkspaceSetupStatus,
	recordUntrackedWorkspaceSetup,
	recordWorkspaceSetupExit,
	recordWorkspaceSetupNotRequired,
	recordWorkspaceSetupStart,
	recoverWorkspaceSetupTerminals,
} from "./workspace-setup";

function fixture(path = ":memory:") {
	const sqlite = new Database(path);
	const db = drizzle(sqlite, { schema });
	migrate(db, {
		migrationsFolder: resolve(import.meta.dir, "../../../../../drizzle"),
	});
	return { sqlite, db: db as unknown as HostDb };
}

function workspace(db: HostDb, id: string) {
	db.insert(schema.workspaces)
		.values({ id, branch: "main", worktreePath: `/fixture/${id}` })
		.run();
}

test.each([
	[0, null, "succeeded"],
	[0, 0, "succeeded"],
	[7, null, "failed"],
	[0, 9, "failed"],
	[null, null, "unknown"],
] as const)("raw setup code=%s signal=%s records %s without null-to-zero conversion", (code, signal, status) => {
	const { sqlite, db } = fixture();
	try {
		workspace(db, "ws");
		recordWorkspaceSetupStart(db, "ws", "setup");
		recordWorkspaceSetupExit(db, "ws", "setup", { code, signal });
		expect(getWorkspaceSetupStatus(db, "ws")).toMatchObject({
			status,
			exitCode: code,
			exitSignal: signal,
		});
	} finally {
		sqlite.close();
	}
});

test("an older setup exit cannot replace a newer run", () => {
	const { sqlite, db } = fixture();
	try {
		workspace(db, "ws");
		recordWorkspaceSetupStart(db, "ws", "old");
		recordWorkspaceSetupStart(db, "ws", "current");
		recordWorkspaceSetupExit(db, "ws", "old", { code: 0, signal: null });
		expect(getWorkspaceSetupStatus(db, "ws")).toMatchObject({
			terminalId: "current",
			status: "running",
			exitCode: null,
		});
	} finally {
		sqlite.close();
	}
});

test("an interactive rerun invalidates tracked success without adding state for legacy-only workspaces", () => {
	const { sqlite, db } = fixture();
	try {
		workspace(db, "tracked");
		workspace(db, "legacy");
		recordWorkspaceSetupStart(db, "tracked", "old");
		recordWorkspaceSetupExit(db, "tracked", "old", { code: 0, signal: null });
		recordUntrackedWorkspaceSetup(db, "tracked", "interactive");
		recordUntrackedWorkspaceSetup(db, "legacy", "old-client");
		expect(getWorkspaceSetupStatus(db, "tracked")).toMatchObject({
			status: "unknown",
			terminalId: "interactive",
			exitCode: null,
			finishedAt: null,
		});
		expect(getWorkspaceSetupStatus(db, "legacy")).toBeNull();
	} finally {
		sqlite.close();
	}
});

test("setup identity and exit evidence survive reopening while the status query remains read-only", async () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-setup-state-"));
	const path = join(root, "fixture.db");
	let { sqlite, db } = fixture(path);
	try {
		workspace(db, "ws");
		recordWorkspaceSetupStart(db, "ws", "setup");
		recordWorkspaceSetupExit(db, "ws", "setup", { code: 7, signal: null });
		sqlite.close();
		({ sqlite, db } = fixture(path));
		const before = getWorkspaceSetupStatus(db, "ws");
		const caller = workspacesRouter.createCaller({
			db,
			isAuthenticated: true,
		} as unknown as HostServiceContext);
		expect(await caller.getSetupStatus({ workspaceId: "ws" })).toEqual(before);
		expect(getWorkspaceSetupStatus(db, "ws")).toEqual(before);
	} finally {
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("recovery adopts only known running setup IDs and missing exit evidence becomes unknown", async () => {
	const { sqlite, db } = fixture();
	try {
		for (const id of ["live", "missing", "finished", "not-required"])
			workspace(db, id);
		recordWorkspaceSetupStart(db, "live", "live-terminal");
		recordWorkspaceSetupStart(db, "missing", "gone-terminal");
		recordWorkspaceSetupStart(db, "finished", "done-terminal");
		recordWorkspaceSetupExit(db, "finished", "done-terminal", {
			code: 0,
			signal: null,
		});
		recordWorkspaceSetupNotRequired(db, "not-required");
		const calls: string[] = [];
		const adopt: typeof createTerminalSessionInternal = async (options) => {
			expect(options.adoptOnly).toBe(true);
			expect(options.oneShotSetup?.command).toBeUndefined();
			expect(options.initialCommand).toBeUndefined();
			calls.push(options.terminalId);
			if (options.terminalId === "live-terminal") {
				options.oneShotSetup?.onExit({ code: 7, signal: null });
				return {} as Awaited<ReturnType<typeof createTerminalSessionInternal>>;
			}
			return { kind: "SESSION_NOT_ACTIVE", error: "No owned setup session" };
		};
		await recoverWorkspaceSetupTerminals({ db } as HostServiceContext, adopt);
		expect(calls.sort()).toEqual(["gone-terminal", "live-terminal"]);
		expect(getWorkspaceSetupStatus(db, "live")).toMatchObject({
			status: "failed",
			exitCode: 7,
		});
		expect(getWorkspaceSetupStatus(db, "missing")).toMatchObject({
			status: "unknown",
			exitCode: null,
		});
		expect(getWorkspaceSetupStatus(db, "finished")).toMatchObject({
			status: "succeeded",
		});
	} finally {
		sqlite.close();
	}
});

test("tracked setup rejects sugar agents or commands before accessing workspace creation", async () => {
	const caller = workspacesRouter.createCaller({
		isAuthenticated: true,
	} as HostServiceContext);
	for (const launch of [
		{ command: "true" },
		{ agents: [{ agent: "claude", prompt: "test" }] },
	]) {
		const error = await caller
			.create({ projectId: "project", trackSetupCompletion: true, ...launch })
			.catch((error: unknown) => error);
		expect(error).toMatchObject({ code: "BAD_REQUEST" });
	}
});
