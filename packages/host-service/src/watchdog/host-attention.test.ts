import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
	mailDeliveries,
	projects,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import { firstDelivery, mailFixture } from "../mail/test-fixture";
import {
	createHostMemoryRuntime,
	readHostWatchdogSnapshot,
} from "../memory/host-runtime";
import { networkFixture } from "../peers/test-fixture";
import { createAttentionSourceLocator } from "./host-source";
import { RuleWatchdog } from "./service";

test("host snapshot carries failed delivery evidence; reminder handling never ACKs the mail", async () => {
	const f = networkFixture();
	const adapter = createHostMemoryRuntime(f.ctx, {
		home: () => f.root,
		clock: { now: f.clock.now, setInterval: () => () => {} },
		listLiveTerminals: async () => [],
	});
	try {
		const sent = f.mail.send({
			teamId: f.teamId,
			to: "leader",
			type: "message",
			subject: "",
			body: "work",
			dedupeKey: "failed-delivery",
		});
		const delivery = firstDelivery(sent);
		f.db
			.update(mailDeliveries)
			.set({ nudgeState: "failed", lastError: "isolated failure" })
			.where(eq(mailDeliveries.id, delivery.id))
			.run();
		await adapter.runtime.watchdog.scan();
		const group = (await adapter.runtime.watchdog.attention())[0];
		assert.ok(group);
		expect(group.severity).toBe("high");
		expect(group.items[0]?.subject).toBe("Mail delivery failed");
		adapter.runtime.watchdog.ignoreAttention({ groupKey: group.groupKey });
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, delivery.id))
				.get()?.ackedAt,
		).toBeNull();
	} finally {
		await adapter.dispose();
		await f.dispose();
	}
});

test("recipient consumption resolves grouped delivery faults; read/ignore leave underlying deliveries unchanged and no Key is read", async () => {
	const f = mailFixture();
	let keyReads = 0,
		modelCalls = 0;
	const adapter = createHostMemoryRuntime(f.ctx, {
		home: () => f.root,
		clock: { now: f.clock.now, setInterval: () => () => {} },
		deepseek: {
			fetch: async () => {
				modelCalls++;
				throw Error("No model calls allowed");
			},
		},
		listLiveTerminals: async () => [],
	});
	adapter.runtime.secrets.readKey = () => {
		keyReads++;
		throw Error("Attention must not read secrets");
	};
	try {
		f.db
			.update(teams)
			.set({ status: "active" })
			.where(eq(teams.id, f.teamId))
			.run();

		for (let i = 0; i < 3; i++)
			f.mail.send({
				teamId: f.teamId,
				to: "leader",
				body: `Mail ${i}`,
				subject: "",
				type: "agent.message",
				dedupeKey: `attention-${i}`,
			});
		f.db.update(mailDeliveries).set({ nudgeState: "failed" }).run();
		f.advance(31 * 60_000);
		await adapter.runtime.watchdog.scan();
		let group = (await adapter.runtime.watchdog.attention())[0];
		assert.ok(group);
		expect(group.activeCount).toBe(3);
		expect(group.source.memberId).toBe(f.memberId);
		adapter.runtime.watchdog.markAttentionRead({ groupKey: group.groupKey });
		adapter.runtime.watchdog.ignoreAttention({
			groupKey: group.groupKey,
			reason: "Waiting",
		});
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.all()
				.every((row) => row.ackedAt === null && row.readAt === null),
		).toBe(true);
		expect(
			(await adapter.runtime.watchdog.attention({ view: "handled" }))[0]
				?.disposition,
		).toBe("ignored");
		f.mail.send({
			teamId: f.teamId,
			to: "leader",
			body: "Fourth",
			subject: "",
			type: "agent.message",
			dedupeKey: "attention-fourth",
		});
		f.db.update(mailDeliveries).set({ nudgeState: "failed" }).run();
		f.advance(31 * 60_000);
		await adapter.runtime.watchdog.scan();
		group = (await adapter.runtime.watchdog.attention())[0];
		assert.ok(group);
		expect(group.activeCount).toBe(4);
		for (const row of f.db.select().from(mailDeliveries).all()) {
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: row.id },
				false,
			);
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: row.id },
				true,
			);
		}
		await adapter.runtime.watchdog.scan();
		expect(
			(await adapter.runtime.watchdog.attention({ view: "handled" }))[0]
				?.disposition,
		).toBe("resolved");
		expect(adapter.runtime.watchdog.badgeSummary().count).toBe(0);
		expect(keyReads).toBe(0);
		expect(modelCalls).toBe(0);
	} finally {
		await adapter.dispose();
		await f.dispose();
	}
});

test("host snapshot includes explicit stopped/fault states and uncertain staging without relying on list absence", async () => {
	const f = networkFixture();
	try {
		f.db
			.update(teamMembers)
			.set({ status: "reconcile_required" })
			.where(eq(teamMembers.id, f.memberId))
			.run();
		const sent = f.mail.send({
			teamId: f.teamId,
			to: "leader",
			type: "agent.message",
			subject: "",
			body: "Uncertain",
			dedupeKey: "uncertain",
		});
		const delivery = sent.deliveries[0];
		assert.ok(delivery);
		f.db
			.update(mailDeliveries)
			.set({ nudgeState: "uncertain_staged" })
			.where(eq(mailDeliveries.id, delivery.id))
			.run();
		let snapshot = readHostWatchdogSnapshot(f.ctx, new Map());
		expect(snapshot.members[0]?.status).toBe("reconcile_required");
		expect(snapshot.members[0]?.activityKnown).toBe(false);
		expect(snapshot.members[0]?.uncertainDeliveryIds).toEqual([delivery.id]);
		const dog = new RuleWatchdog({
			db: f.sqlite,
			snapshot: () => readHostWatchdogSnapshot(f.ctx, new Map()),
			clock: { now: f.clock.now, setInterval: () => () => {} },
		});
		await dog.scan();
		expect((await dog.attention())[0]?.activeCount).toBe(2);
		expect(dog.badgeSummary().count).toBe(1);
		f.db
			.update(teamMembers)
			.set({ status: "stopped" })
			.where(eq(teamMembers.id, f.memberId))
			.run();
		snapshot = readHostWatchdogSnapshot(f.ctx, new Map());
		expect(snapshot.members[0]?.status).toBe("stopped");
		await dog.scan();
		expect((await dog.attention({ view: "handled" }))[0]?.disposition).toBe(
			"resolved",
		);
		await dog.dispose();
	} finally {
		await f.dispose();
	}
});

test("source locator requires live process plus durable ownership, rejects disposal and falls back without a PTY restore", async () => {
	const f = networkFixture();
	try {
		f.db
			.insert(projects)
			.values({ id: "project", name: "P", repoPath: f.root })
			.run();
		f.db
			.insert(workspaces)
			.values({
				id: "workspace",
				projectId: "project",
				worktreePath: f.root,
				branch: "main",
			})
			.run();
		f.db
			.insert(terminalSessions)
			.values({ id: "terminal", originWorkspaceId: "workspace" })
			.run();
		f.db
			.update(teamMembers)
			.set({ workspaceId: "workspace", terminalId: "terminal" })
			.where(eq(teamMembers.id, f.memberId))
			.run();
		let live: { terminalId: string; workspaceId: string }[] = [];
		let probes = 0;
		const locate = createAttentionSourceLocator(f.ctx, {
			listLiveTerminals: async () => {
				probes++;
				return live;
			},
		});
		const source = {
			kind: "team_member" as const,
			teamId: f.teamId,
			memberId: f.memberId,
		};
		let [target] = await locate([source]);
		expect(target?.terminalLive).toBe(false);
		expect(target?.fallback).toBe("workspace");
		live = [{ terminalId: "terminal", workspaceId: "workspace" }];
		[target] = await locate([source]);
		expect(target?.terminalLive).toBe(true);
		expect(target?.projectId).toBe("project");
		f.db
			.update(terminalSessions)
			.set({ disposeRequestedAt: 1 })
			.where(eq(terminalSessions.id, "terminal"))
			.run();
		[target] = await locate([source]);
		expect(target?.terminalLive).toBe(false);
		expect(probes).toBe(2);
		f.db
			.update(terminalSessions)
			.set({ disposeRequestedAt: null })
			.where(eq(terminalSessions.id, "terminal"))
			.run();
		f.db
			.update(workspaces)
			.set({ archivedAt: 1 })
			.where(eq(workspaces.id, "workspace"))
			.run();
		[target] = await locate([source]);
		expect(target?.terminalLive).toBe(false);
		expect(target?.fallback).toBe("team");
		f.db
			.update(workspaces)
			.set({ archivedAt: null })
			.where(eq(workspaces.id, "workspace"))
			.run();
		const projectRace = createAttentionSourceLocator(f.ctx, {
			listLiveTerminals: async () => {
				f.db
					.update(projects)
					.set({ deletedAt: 3 })
					.where(eq(projects.id, "project"))
					.run();
				return live;
			},
		});
		[target] = await projectRace([source]);
		expect(target?.terminalLive).toBe(false);
		expect(target?.fallback).toBe("team");
		expect((await locate([{ kind: "memory" }]))[0]?.fallback).toBe("memory");
		expect(
			(
				await locate([
					{
						kind: "automation_run",
						automationId: "cron",
						automationRunId: "run",
					},
				])
			)[0]?.fallback,
		).toBe("automations");
		f.db
			.update(workspaces)
			.set({ archivedAt: null })
			.where(eq(workspaces.id, "workspace"))
			.run();
		f.db
			.update(projects)
			.set({ deletedAt: null })
			.where(eq(projects.id, "project"))
			.run();
		const racing = createAttentionSourceLocator(f.ctx, {
			listLiveTerminals: async () => {
				f.db
					.update(workspaces)
					.set({ archivedAt: 2 })
					.where(eq(workspaces.id, "workspace"))
					.run();
				return [];
			},
		});
		[target] = await racing([source]);
		expect(target?.terminalLive).toBe(false);
		expect(target?.fallback).toBe("team");
	} finally {
		await f.dispose();
	}
});
