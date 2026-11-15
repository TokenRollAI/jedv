import { expect, test } from "bun:test";
import { memoryFixture } from "../memory/test-fixture";
import { RuleWatchdog, type WatchdogSnapshot } from "./service";

function fixture() {
	const f = memoryFixture();
	let now = 1_000_000;
	const snapshot: WatchdogSnapshot = {
		members: [],
		mail: [],
		automationRuns: [],
	};
	const dog = new RuleWatchdog({
		db: f.db,
		snapshot: () => snapshot,
		clock: { now: () => now, setInterval: () => () => {} },
	});
	return {
		...f,
		dog,
		snapshot,
		advance(ms = 30_000) {
			now += ms;
		},
		async close() {
			await dog.dispose();
			await f.dispose();
		},
	};
}
test("read, ignore, genuine ACK and a new same-source instance remain separate", async () => {
	const f = fixture();
	try {
		for (let i = 0; i < 3; i++)
			f.snapshot.mail.push({
				id: `delivery-${i}`,
				teamId: "team",
				recipientMemberId: "member",
				createdAt: 1,
				ackedAt: null,
				workspaceId: "workspace",
				terminalId: "terminal",
			});
		await f.dog.scan();
		let group = (await f.dog.attention())[0]!;
		expect(group.groupKey).toBe("mail_unacked:team:member");
		expect(group.activeCount).toBe(3);
		expect(group.totalCount).toBe(3);
		expect(group.items).toHaveLength(3);
		expect(group.source.mailDeliveryId).toBe("delivery-2");
		expect(f.dog.badgeSummary().count).toBe(0);
		expect(
			f.dog.markAttentionRead({ groupKey: group.groupKey }).updatedCount,
		).toBe(3);
		group = (await f.dog.attention())[0]!;
		expect(group.disposition).toBe("open");
		expect(group.unread).toBe(false);
		expect(
			f.dog.ignoreAttention({
				groupKey: group.groupKey,
				reason: "Waiting for human",
			}).updatedCount,
		).toBe(3);
		expect(await f.dog.attention()).toHaveLength(0);
		group = (await f.dog.attention({ view: "handled" }))[0]!;
		expect(group.disposition).toBe("ignored");
		expect(
			group.items.every(
				(item) =>
					item.ignoreReason === "Waiting for human" && item.resolvedAt === null,
			),
		).toBe(true);
		expect(f.snapshot.mail.every((mail) => mail.ackedAt === null)).toBe(true);
		f.advance();
		f.snapshot.mail.push({
			id: "delivery-3",
			teamId: "team",
			recipientMemberId: "member",
			createdAt: 1,
			ackedAt: null,
		});
		await f.dog.scan();
		group = (await f.dog.attention())[0]!;
		expect(group.activeCount).toBe(4);
		expect(group.unread).toBe(true);
		expect(group.items.filter((item) => item.ignoredAt === null)).toHaveLength(
			1,
		);
		// A partial / empty scan does not prove ACK or any other recovery.
		const mails = f.snapshot.mail;
		f.snapshot.mail = [];
		await f.dog.scan();
		expect((await f.dog.attention())[0]?.activeCount).toBe(4);
		f.snapshot.mail = mails.map((mail) => ({ ...mail, ackedAt: 2_000_000 }));
		await f.dog.scan();
		group = (await f.dog.attention({ view: "handled" }))[0]!;
		expect(group.disposition).toBe("resolved");
		expect(group.activeCount).toBe(0);
		expect(group.totalCount).toBe(4);
		expect(
			group.items.filter((item) => item.ignoreReason === "Waiting for human"),
		).toHaveLength(3);
	} finally {
		await f.close();
	}
});
test("full badge counts unique unread high groups independently of page and item limits", async () => {
	const f = fixture();
	try {
		for (let i = 0; i < 130; i++)
			f.snapshot.automationRuns.push({
				id: `run-${i}`,
				automationId: `cron-${i}`,
				status: "failed",
				createdAt: 1,
				finishedAt: 2,
			});
		for (let i = 0; i < 25; i++)
			f.snapshot.automationRuns.push({
				id: `repeat-${i}`,
				automationId: "cron-0",
				status: "failed",
				createdAt: 3,
				finishedAt: 4,
			});
		f.snapshot.members.push({
			id: "quiet",
			teamId: "team",
			working: true,
			startedAt: 1,
			lastAgentActivityAt: 1,
			lastGitActivityAt: null,
		});
		await f.dog.scan();
		expect(await f.dog.attention({ limit: 1 })).toHaveLength(1);
		expect(f.dog.badgeSummary(7)).toEqual({
			pendingApprovals: 7,
			unreadHighFaultGroups: 130,
			count: 137,
		});
		const group = (await f.dog.attention({ limit: 500 })).find(
			(item) => item.groupKey === "automation_failed:cron-0",
		)!;
		expect(group.totalCount).toBe(26);
		expect(group.activeCount).toBe(26);
		expect(group.items).toHaveLength(20);
		f.dog.markAttentionRead({ groupKey: group.groupKey });
		expect(f.dog.badgeSummary(7).count).toBe(136);
		expect(
			(await f.dog.attention({ limit: 500 })).find(
				(item) => item.groupKey === group.groupKey,
			)?.disposition,
		).toBe("open");
		f.dog.ignoreAttention({ groupKey: "automation_failed:cron-1" });
		expect(f.dog.badgeSummary().unreadHighFaultGroups).toBe(128);
	} finally {
		await f.close();
	}
});
test("automation recovery needs explicit newer success, not a truncated failure list", async () => {
	const f = fixture();
	try {
		f.snapshot.automationRuns = [
			{
				id: "failed",
				automationId: "cron",
				status: "failed",
				createdAt: 10,
				finishedAt: 20,
			},
		];
		await f.dog.scan();
		f.snapshot.automationRuns = [];
		await f.dog.scan();
		expect(await f.dog.attention()).toHaveLength(1);
		f.snapshot.automationRuns = [
			{
				id: "old-success",
				automationId: "cron",
				status: "succeeded",
				createdAt: 1,
				finishedAt: 5,
			},
		];
		await f.dog.scan();
		expect(await f.dog.attention()).toHaveLength(1);
		f.snapshot.automationRuns = [
			{
				id: "new-success",
				automationId: "cron",
				status: "succeeded",
				createdAt: 1_100_000,
				finishedAt: 1_200_000,
			},
		];
		await f.dog.scan();
		expect((await f.dog.attention({ view: "handled" }))[0]?.disposition).toBe(
			"resolved",
		);
		f.advance();
		f.snapshot.automationRuns.push({
			id: "failed-again",
			automationId: "cron",
			status: "failed",
			createdAt: 1_300_000,
			finishedAt: 1_400_000,
		});
		await f.dog.scan();
		expect((await f.dog.attention())[0]?.activeCount).toBe(1);
	} finally {
		await f.close();
	}
});
test("stalled and team faults recover only with explicit facts; repeated episodes get a new dedupe identity", async () => {
	const f = fixture();
	try {
		const member = {
			id: "member",
			teamId: "team",
			status: "failed",
			teamStatus: "active",
			working: false,
			activityKnown: false,
			startedAt: 1,
			lastAgentActivityAt: 1,
			lastGitActivityAt: null,
			uncertainDeliveryIds: [] as string[],
		};
		f.snapshot.members = [member];
		await f.dog.scan();
		let group = (await f.dog.attention())[0]!;
		expect(group.kind).toBe("team_attention");
		expect(group.severity).toBe("high");
		const original = group.items[0]!.dedupeKey;
		f.dog.ignoreAttention({ groupKey: group.groupKey });
		f.snapshot.members = [];
		await f.dog.scan();
		expect((await f.dog.attention({ view: "handled" }))[0]?.disposition).toBe(
			"ignored",
		);
		member.status = "active";
		f.snapshot.members = [member];
		await f.dog.scan();
		expect((await f.dog.attention({ view: "handled" }))[0]?.disposition).toBe(
			"resolved",
		);
		member.status = "failed";
		await f.dog.scan();
		group = (await f.dog.attention())[0]!;
		expect(group.activeCount).toBe(1);
		expect(group.items[0]?.dedupeKey).not.toBe(original);
		expect(f.dog.badgeSummary().count).toBe(1);
		member.status = "active";
		member.working = true;
		member.activityKnown = true;
		await f.dog.scan();
		group = (await f.dog.attention())[0]!;
		expect(group.kind).toBe("suspected_stalled");
		member.activityKnown = false;
		member.working = false;
		await f.dog.scan();
		expect((await f.dog.attention())[0]?.kind).toBe("suspected_stalled");
		member.activityKnown = true;
		member.lastAgentActivityAt = 1_000_000;
		await f.dog.scan();
		expect(await f.dog.attention()).toHaveLength(0);
		member.uncertainDeliveryIds = ["uncertain-mail"];
		await f.dog.scan();
		expect((await f.dog.attention())[0]?.source.mailDeliveryId).toBe(
			"uncertain-mail",
		);
		member.uncertainDeliveryIds = [];
		await f.dog.scan();
		expect(await f.dog.attention()).toHaveLength(0);
	} finally {
		await f.close();
	}
});
test("legacy rows get metadata only from exact structured dedupe matches, never body guesses", async () => {
	const f = fixture();
	try {
		const insert = f.db.prepare(
			"INSERT INTO watchdog_alerts(id,dedupe_key,kind,subject,body,team_id,created_at) VALUES(?,?,?,?,?,?,?)",
		);
		insert.run(
			"legacy",
			"automation:real-run",
			"automation_failed",
			"Old",
			"Automation fake-id, run fake-run",
			null,
			1,
		);
		insert.run(
			"unmatched",
			"opaque",
			"mail_unacked",
			"Old",
			"Delivery should-not-be-parsed has not been acknowledged.",
			"team",
			2,
		);
		insert.run(
			"aged-out",
			"automation:aged-out-run",
			"automation_failed",
			"Old",
			"No source inference allowed",
			null,
			3,
		);
		f.snapshot.automationRuns = [
			{
				id: "real-run",
				automationId: "real-cron",
				status: "failed",
				finishedAt: 1,
			},
		];
		await f.dog.scan();
		const groups = await f.dog.attention();
		const old = groups.find(
			(group) => group.groupKey === "automation_failed:real-cron",
		)!;
		expect(old.items[0]?.automationRunId).toBe("real-run");
		expect(old.items[0]?.automationId).toBe("real-cron");
		expect(old.severity).toBe("high");
		const unknown = groups.find((group) => group.groupKey === "opaque")!;
		expect(unknown.source.mailDeliveryId).toBeNull();
		expect(unknown.source.terminalLive).toBe(false);
		expect(f.dog.badgeSummary().unreadHighFaultGroups).toBe(2);
		expect(() => f.dog.markAttentionRead({})).toThrow();
		expect(() =>
			f.dog.ignoreAttention({ alertId: "legacy", groupKey: "opaque" }),
		).toThrow();
	} finally {
		await f.close();
	}
});
