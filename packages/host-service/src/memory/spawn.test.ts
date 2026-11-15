import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "@jedv/shared/sqlite-migrations";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { TeamService } from "../teams/service";
import type { createTerminalSessionInternal } from "../terminal/terminal";
import { TerminalAgentStore } from "../terminal-agents/store";
import type { HostServiceContext } from "../types";
import { createHostMemoryRuntime } from "./host-runtime";

test("Team spawn injects bounded core memory for the actual target project and Team, preserving task/idempotency", async () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-memory-spawn-"));
	const sqlite = new Database(":memory:");
	runMigrations(drizzle(sqlite), resolve(import.meta.dir, "../../drizzle"));
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	const store = new TerminalAgentStore();
	const ctx = {
		db,
		terminalAgentStore: store,
		runtime: {},
		eventBus: {
			broadcastTeamChanged: () => {},
			onTerminalLifecycle: () => () => {},
		},
	} as unknown as HostServiceContext;
	const adapter = createHostMemoryRuntime(ctx, { home: () => root });
	ctx.runtime.memory = adapter.runtime;
	let calls = 0;
	let command = "";
	const service = new TeamService(ctx, {
		launch: async (input) => {
			calls++;
			command = input.initialCommand ?? "";
			db.insert(schema.terminalSessions)
				.values({ id: input.terminalId, originWorkspaceId: input.workspaceId })
				.run();
			return { terminalId: input.terminalId } as Awaited<
				ReturnType<typeof createTerminalSessionInternal>
			>;
		},
	});
	try {
		for (const id of ["p1", "p2"])
			db.insert(schema.projects).values({ id, name: id, repoPath: root }).run();
		for (const id of ["1", "2"])
			db.insert(schema.workspaces)
				.values({
					id: `w${id}`,
					projectId: `p${id}`,
					worktreePath: root,
					type: "local",
					branch: "main",
				})
				.run();
		db.insert(schema.hostAgentConfigs)
			.values({
				id: "config",
				presetId: "claude",
				label: "Fixture",
				command: "/bin/echo",
				promptTransport: "argv",
				displayOrder: 0,
			})
			.run();
		for (const id of ["team", "other"])
			db.insert(schema.teams)
				.values({
					id,
					name: id,
					goal: "",
					status: "active",
					originWorkspaceId: "w1",
					createdAt: 1,
					updatedAt: 1,
				})
				.run();
		const memory = adapter.runtime.memory;
		memory.put({
			scopeKind: "global",
			title: "Global",
			content: "global convention",
		});
		memory.put({
			scopeKind: "project",
			scopeId: "p1",
			title: "Origin",
			content: "origin-only-must-not-inject",
		});
		memory.put({
			scopeKind: "project",
			scopeId: "p2",
			title: "Target",
			content: "target-project-must-inject",
		});
		memory.put({
			scopeKind: "project",
			scopeId: "p2",
			title: "Archival",
			content: "archival-must-not-inject",
			tier: "archival",
		});
		memory.put({
			scopeKind: "team",
			scopeId: "team",
			title: "Team",
			content: "current-team-must-inject",
		});
		memory.put({
			scopeKind: "team",
			scopeId: "other",
			title: "Other",
			content: "other-team-must-not-inject",
		});
		memory.propose({
			scopeKind: "global",
			scopeId: "",
			title: "Candidate",
			content: "candidate-must-not-inject",
			tier: "core",
			category: "context",
			sourceRef: "terminal",
		});
		const input = {
			teamId: "team",
			name: "worker",
			agent: "config",
			prompt: "original task",
			operationId: "op",
			workspaceId: "w2",
			newWorktree: false,
		};
		const first = await service.spawn(input);
		const second = await service.spawn(input);
		expect(calls).toBe(1);
		expect(second.id).toBe(first.id);
		expect(first.taskSummary).toBe("original task");
		expect(command).toContain("original task");
		for (const text of [
			"global convention",
			"target-project-must-inject",
			"current-team-must-inject",
		])
			expect(command).toContain(text);
		for (const text of [
			"origin-only-must-not-inject",
			"archival-must-not-inject",
			"other-team-must-not-inject",
			"candidate-must-not-inject",
		])
			expect(command).not.toContain(text);
		expect(command).not.toContain("deepseek.key");
	} finally {
		service.dispose();
		await adapter.dispose();
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
});
