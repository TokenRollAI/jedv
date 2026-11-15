import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { memoryFixture } from "../memory/test-fixture";
import { RuleWatchdog, type WatchdogSnapshot } from "./service";

function fixture() {
	const f = memoryFixture();
	let now = 1000000;
	let tick = () => {};
	let stopped = 0;
	let scheduled = 0;
	const snapshot: WatchdogSnapshot = {
		members: [],
		mail: [],
		automationRuns: [],
	};
	const clock = {
		now: () => now,
		setInterval(fn: () => void, ms: number) {
			scheduled++;
			expect(ms).toBe(30000);
			tick = fn;
			return () => {
				stopped++;
			};
		},
	};
	return {
		...f,
		snapshot,
		clock,
		advance: (ms: number) => {
			now += ms;
			tick();
		},
		scheduled: () => scheduled,
		stopped: () => stopped,
	};
}
test("30s rules with manual Clock dedupe mail and failure, read remains unacked", async () => {
	const f = fixture();
	try {
		const sent: string[] = [];
		const dog = new RuleWatchdog({
			db: f.db,
			snapshot: () => f.snapshot,
			clock: f.clock,
			mail: {
				publishAlert: async (alert) => {
					sent.push(alert.dedupeKey);
				},
			},
		});
		f.snapshot.mail.push({
			id: "delivery",
			teamId: "t",
			createdAt: 0,
			ackedAt: null,
		});
		f.snapshot.automationRuns.push({
			id: "run1",
			automationId: "a1",
			status: "failed",
			finishedAt: 1,
		});
		dog.start();
		dog.start();
		expect(f.scheduled()).toBe(1);
		f.advance(30000);
		await dog.scan();
		await dog.scan();
		expect(dog.listAlerts()).toHaveLength(2);
		expect(sent).toHaveLength(2);
		const alert = dog.listAlerts()[0];
		assert.ok(alert);
		dog.markRead(alert.id);
		expect(dog.listAlerts()).toHaveLength(1);
		expect(dog.listAlerts({ status: "all" })).toHaveLength(2);
		const mail = f.snapshot.mail[0];
		assert.ok(mail);
		mail.ackedAt = f.clock.now();
		await dog.scan();
		expect(sent).toHaveLength(2);
		await dog.dispose();
		expect(f.stopped()).toBe(1);
	} finally {
		await f.dispose();
	}
});
test("long active tasks and permission waits do not alert, silent tasks are only suspected stalled", async () => {
	const f = fixture();
	try {
		f.snapshot.members.push(
			{
				id: "busy",
				teamId: "t",
				working: true,
				startedAt: 0,
				lastAgentActivityAt: 999999,
				lastGitActivityAt: 0,
			},
			{
				id: "git-active",
				teamId: "t",
				working: true,
				startedAt: 0,
				lastAgentActivityAt: 0,
				lastGitActivityAt: 999999,
			},
			{
				id: "silent",
				teamId: "t",
				working: true,
				startedAt: 0,
				lastAgentActivityAt: 0,
				lastGitActivityAt: 0,
			},
			{
				id: "waiting",
				teamId: "t",
				working: true,
				startedAt: 0,
				lastAgentActivityAt: 0,
				lastGitActivityAt: 0,
				permissionRequested: true,
			},
		);
		const dog = new RuleWatchdog({
			db: f.db,
			snapshot: () => f.snapshot,
			clock: f.clock,
		});
		await dog.scan();
		const alerts = dog.listAlerts();
		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.kind).toBe("suspected_stalled");
		expect(alerts[0]?.body).toContain("suspicion");
		await dog.scan();
		expect(dog.listAlerts()).toHaveLength(1);
		await dog.dispose();
	} finally {
		await f.dispose();
	}
});
test("failed alert transport retries stable dedupe key and survives watchdog restart", async () => {
	const f = fixture();
	try {
		f.snapshot.mail.push({
			id: "d",
			teamId: null,
			createdAt: 0,
			ackedAt: null,
		});
		let attempts = 0;
		const keys: string[] = [];
		const mail = {
			publishAlert: async (alert: { dedupeKey: string }) => {
				attempts++;
				keys.push(alert.dedupeKey);
				if (attempts === 1) throw new Error("offline");
			},
		};
		const dog = new RuleWatchdog({
			db: f.db,
			snapshot: () => f.snapshot,
			clock: f.clock,
			mail,
		});
		await dog.scan();
		await dog.dispose();
		const restarted = new RuleWatchdog({
			db: f.db,
			snapshot: () => f.snapshot,
			clock: f.clock,
			mail,
		});
		await restarted.scan();
		await restarted.scan();
		expect(attempts).toBe(2);
		expect(keys[0]).toBe(keys[1]);
		expect(restarted.listAlerts()).toHaveLength(1);
		await restarted.dispose();
	} finally {
		await f.dispose();
	}
});
