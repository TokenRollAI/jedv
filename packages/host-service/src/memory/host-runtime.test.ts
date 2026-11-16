import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "@jedv/shared/sqlite-migrations";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { LocalAutomations } from "../automations/automations";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { mailFixture } from "../mail/test-fixture";
import { TerminalAgentStore } from "../terminal-agents/store";
import type { HostServiceContext } from "../types";
import {
	createHostMemoryRuntime,
	readHostWatchdogSnapshot,
} from "./host-runtime";

test("watchdog snapshots distinguish recipient consumption from human inspection and preserve notification attempts", async () => {
	const f = mailFixture();
	try {
		const sent = f.send("watchdog-receipt");
		const id = sent.deliveries[0]?.id;
		if (!id) throw new Error("Missing delivery");
		f.db
			.update(schema.mailDeliveries)
			.set({
				nudgeState: "nudged",
				nudgedAt: 123,
				attemptCount: 2,
				readAt: 456,
			})
			.where(eq(schema.mailDeliveries.id, id))
			.run();
		const snapshot = () =>
			readHostWatchdogSnapshot(f.ctx, new Map()).mail.find(
				(row) => row.id === id,
			);
		expect(snapshot()).toMatchObject({
			nudgeState: "nudged",
			nudgedAt: 123,
			attemptCount: 2,
			recipientReadAt: null,
		});
		f.mail.consume({ teamId: f.teamId, deliveryId: id }, false);
		expect(snapshot()?.recipientReadAt).toBeNull();
		const received = f.mail.consume({ actor: f.actor, deliveryId: id }, false);
		expect(snapshot()?.recipientReadAt).toBe(received.delivery.receipt?.readAt);
		expect(snapshot()?.recipientReadAt).not.toBe(456);
	} finally {
		await f.dispose();
	}
});

test("real Team/Mail/Automation state drives informational alerts, Git activity suppresses long-task suspicion", async () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-watchdog-host-")),
		sqlite = new Database(":memory:");
	runMigrations(drizzle(sqlite), resolve(import.meta.dir, "../../drizzle"));
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	let now = 10000000;
	let cancel = 0;
	const clock = {
		now: () => now,
		setInterval(_fn: () => void, ms: number) {
			expect(ms).toBe(30000);
			return () => {
				cancel++;
			};
		},
	};
	const automations = new LocalAutomations({
		home: root,
		execute: async () => {},
		clock,
	});
	const store = new TerminalAgentStore();
	const ctx = {
		db,
		terminalAgentStore: store,
		runtime: { automations },
	} as unknown as HostServiceContext;
	const adapter = createHostMemoryRuntime(ctx, { home: () => root, clock });
	try {
		db.insert(schema.projects)
			.values({ id: "p", name: "P", repoPath: root })
			.run();
		db.insert(schema.workspaces)
			.values({ id: "w", projectId: "p", worktreePath: root, branch: "main" })
			.run();
		db.insert(schema.terminalSessions)
			.values({ id: "t", originWorkspaceId: "w" })
			.run();
		db.insert(schema.teams)
			.values({
				id: "team",
				name: "Team",
				goal: "",
				status: "active",
				createdAt: 1,
				updatedAt: 1,
			})
			.run();
		db.insert(schema.teamMembers)
			.values({
				id: "m",
				teamId: "team",
				name: "leader",
				role: "leader",
				status: "active",
				operationId: "m",
				requestFingerprint: "m",
				requestJson: "{}",
				workspaceId: "w",
				terminalId: "t",
				agentId: "claude",
				expectedLaunchId: "launch",
				boundStartedAt: 1,
				boundAgentSessionId: "session",
				taskSummary: "task",
				joinedAt: 1,
			})
			.run();
		store.recordEvent({
			terminalId: "t",
			workspaceId: "w",
			agentId: "claude",
			agentSessionId: "session",
			launchId: "launch",
			eventType: "Start",
			occurredAt: 1,
			hook: { trusted: true, sequence: 1, eventType: "Start" },
		});
		adapter.runtime.start();
		await adapter.runtime.watchdog.scan();
		expect(adapter.runtime.watchdog.listAlerts()).toHaveLength(1);
		expect(adapter.runtime.watchdog.listAlerts()[0]?.kind).toBe(
			"suspected_stalled",
		);
		adapter.recordGitActivity("w");
		await adapter.runtime.watchdog.scan();
		expect(adapter.runtime.watchdog.listAlerts()).toHaveLength(1);
		db.insert(schema.mailEvents)
			.values({
				id: "e",
				teamId: "team",
				threadId: "e",
				type: "message",
				sourceKind: "human",
				sourceId: "human",
				dedupeKey: "e",
				requestFingerprint: "e",
				subject: "",
				body: "",
				createdAt: 1,
			})
			.run();
		db.insert(schema.mailDeliveries)
			.values({
				id: "d",
				eventId: "e",
				recipientMemberId: "m",
				nudgeState: "failed",
				attemptCount: 2,
				readAt: 2,
				createdAt: 1,
			})
			.run();
		// Seed an actual AutomationStore file before opening a second scheduler adapter.
		const definition = {
			id: "00000000-0000-4000-8000-000000000001",
			name: "cron",
			prompt: "task",
			agent: "claude",
			target: { kind: "workspace", workspaceId: "w" },
			enabled: false,
			rrule: null,
			timezone: "UTC",
			createdAt: 1,
			updatedAt: 1,
			nextRunAt: null,
		};
		const run = {
			id: "00000000-0000-4000-8000-000000000002",
			automationId: definition.id,
			trigger: "manual",
			scheduledAt: null,
			status: "failed",
			createdAt: 1,
			updatedAt: 2,
			finishedAt: 2,
			workspaceId: "w",
			terminalId: null,
			chatSessionId: null,
			nativeSessionId: null,
			error: "fixture failure",
		};
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			join(root, "automations.json"),
			JSON.stringify({ version: 1, definitions: [definition], runs: [run] }),
		);
		ctx.runtime.automations = new LocalAutomations({
			home: root,
			execute: async () => {},
			clock,
		});
		await adapter.runtime.watchdog.scan();
		const alerts = adapter.runtime.watchdog.listAlerts();
		expect(alerts).toHaveLength(3);
		expect(alerts.map((a) => a.kind).sort()).toEqual([
			"automation_failed",
			"mail_unacked",
			"suspected_stalled",
		]);
		await adapter.runtime.watchdog.scan();
		expect(adapter.runtime.watchdog.listAlerts()).toHaveLength(3);
		expect(store.get("t")?.launchId).toBe("launch");
		now += 30000;
	} finally {
		await adapter.dispose();
		automations.dispose();
		ctx.runtime.automations?.dispose();
		sqlite.close();
		rmSync(root, { recursive: true, force: true });
	}
	expect(cancel).toBe(1);
});
