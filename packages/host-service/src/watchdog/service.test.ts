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
test("routine mail never becomes a human ACK task; retiring legacy alerts preserves consumption facts", async () => {
	const f = fixture();
	const dog = new RuleWatchdog({
		db: f.db,
		snapshot: () => f.snapshot,
		clock: f.clock,
	});
	try {
		f.snapshot.mail.push({
			id: "normal",
			teamId: "t",
			recipientMemberId: "active",
			createdAt: 0,
			ackedAt: null,
			nudgeState: "nudged",
		});
		f.snapshot.members.push({
			id: "active",
			teamId: "t",
			status: "active",
			teamStatus: "active",
			activityKnown: true,
			working: true,
			startedAt: 0,
			lastAgentActivityAt: f.clock.now(),
			lastGitActivityAt: null,
		});
		f.db
			.prepare(
				"INSERT INTO watchdog_alerts(id,dedupe_key,kind,subject,body,team_id,created_at) VALUES('legacy-mail','mail:normal','mail_unacked','Old','Unacked','t',1)",
			)
			.run();
		await dog.scan();
		expect(await dog.attention()).toEqual([]);
		expect((await dog.attention({ view: "handled" }))[0]?.disposition).toBe(
			"resolved",
		);
		expect(f.snapshot.mail[0]?.ackedAt).toBeNull();
		f.snapshot.members = [];
		await dog.scan();
		expect(await dog.attention()).toEqual([]);
	} finally {
		await dog.dispose();
		await f.dispose();
	}
});

test("missing member is not stopped-recipient recovery evidence; explicit live state recovers without ACK", async () => {
	const f = fixture();
	const dog = new RuleWatchdog({
		db: f.db,
		snapshot: () => f.snapshot,
		clock: f.clock,
		mailAfterMs: 100,
	});
	try {
		const member = {
			id: "stopped",
			teamId: "t",
			status: "stopped",
			teamStatus: "active",
			working: false,
			startedAt: 0,
			lastAgentActivityAt: 0,
			lastGitActivityAt: null,
		};
		f.snapshot.members = [member];
		f.snapshot.mail = [
			{
				id: "pending",
				teamId: "t",
				recipientMemberId: "stopped",
				createdAt: 0,
				ackedAt: null,
				nudgeState: "pending",
			},
		];
		await dog.scan();
		expect(await dog.attention()).toHaveLength(1);
		f.snapshot.members = [];
		await dog.scan();
		expect(await dog.attention()).toHaveLength(1);
		f.snapshot.members = [{ ...member, status: "active" }];
		await dog.scan();
		expect(await dog.attention()).toHaveLength(0);
		expect(f.snapshot.mail[0]?.ackedAt).toBeNull();
	} finally {
		await dog.dispose();
		await f.dispose();
	}
});

test("submitted notification without subsequent Agent activity is an explicit recovery exception, not an ACK-age reminder", async () => {
	const f = fixture();
	const dog = new RuleWatchdog({
		db: f.db,
		snapshot: () => f.snapshot,
		clock: f.clock,
	});
	try {
		f.snapshot.members = [
			{
				id: "member",
				teamId: "t",
				status: "active",
				teamStatus: "active",
				working: false,
				activityKnown: true,
				startedAt: 1,
				lastAgentActivityAt: 1,
				lastGitActivityAt: null,
			},
		];
		f.snapshot.mail = [
			{
				id: "unobserved",
				teamId: "t",
				recipientMemberId: "member",
				createdAt: 0,
				ackedAt: null,
				nudgeState: "nudged",
				nudgedAt: 10,
				attemptCount: 1,
				recipientReadAt: null,
			},
		];
		await dog.scan();
		expect((await dog.attention())[0]?.items[0]?.subject).toBe(
			"Mail notification has no Agent activity confirmation",
		);
		f.snapshot.members = [];
		await dog.scan();
		expect(await dog.attention()).toHaveLength(1);
		f.snapshot.members = [
			{
				id: "member",
				teamId: "t",
				status: "active",
				teamStatus: "active",
				working: true,
				activityKnown: true,
				startedAt: 1,
				lastAgentActivityAt: f.clock.now(),
				lastGitActivityAt: null,
			},
		];
		await dog.scan();
		expect(await dog.attention()).toHaveLength(0);
		expect(f.snapshot.mail[0]?.ackedAt).toBeNull();
	} finally {
		await dog.dispose();
		await f.dispose();
	}
});
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
			nudgeState: "failed",
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
			nudgeState: "failed",
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
