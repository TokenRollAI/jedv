import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { AUTO_NUDGE_WINDOW_MS } from "@jedv/shared/teamwork";
import { eq } from "drizzle-orm";
import { mailDeliveries, teamMembers } from "../db/schema";
import { MAIL_PROCESSING_LEASE_MS } from "./policy";
import { MailService } from "./service";
import { firstDelivery, mailFixture } from "./test-fixture";

test("an earlier shared timer rearms a later unread notification without another hook", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		const first = f.send("early-timer");
		await f.mail.flush();
		const input = {
			teamId: f.teamId,
			actor: f.actor,
			deliveryId: firstDelivery(first).id,
		};
		f.mail.consume(input, false);
		f.mail.consume(input, true);
		f.advance(20_000);
		f.hook("Start");
		f.hook("Stop");
		const later = f.send("later-timer");
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		f.advance(40_000);
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		f.advance(19_999);
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		f.advance(1);
		await f.mail.flush();
		expect(f.writes).toHaveLength(3);
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(later).id))
				.get()?.attemptCount,
		).toBe(2);
		f.advance(3 * AUTO_NUDGE_WINDOW_MS);
		await f.mail.flush();
		expect(f.writes).toHaveLength(3);
	} finally {
		await f.dispose();
	}
});

test("an unread notification after restart retains its future reminder deadline", async () => {
	const f = mailFixture();
	let restarted: MailService | undefined;
	try {
		f.hook("Start");
		f.hook("Stop");
		f.send("restart-before-deadline");
		await f.mail.flush();
		await f.mail.dispose();
		f.advance(20_000);
		restarted = new MailService(f.team, f.mail.deps);
		f.hook("Start");
		f.hook("Stop");
		restarted.start();
		await restarted.flush();
		f.advance(39_999);
		await restarted.flush();
		expect(f.writes).toHaveLength(1);
		f.advance(1);
		await restarted.flush();
		expect(f.writes).toHaveLength(2);
	} finally {
		await restarted?.dispose();
		await f.dispose();
	}
});

test("due reminders retain bounded timers without reusing idle permission or overwriting a draft", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("reminder-needs-new-idle");
		await f.mail.flush();
		for (let attempt = 0; attempt < 3; attempt++) {
			f.advance(AUTO_NUDGE_WINDOW_MS);
			await f.mail.flush();
			expect(f.writes).toHaveLength(1);
			expect([...f.timers.values()].map((timer) => timer.at)).toEqual([
				f.clock.now() + AUTO_NUDGE_WINDOW_MS,
			]);
		}
		f.hook("Start");
		f.hook("Stop");
		const binding = f.store.get(f.actor.terminalId);
		assert.ok(binding);
		f.store.invalidateAutomaticDelivery(binding);
		await f.mail.flush();
		f.advance(AUTO_NUDGE_WINDOW_MS);
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		const input = {
			teamId: f.teamId,
			actor: f.actor,
			deliveryId: firstDelivery(sent).id,
		};
		f.mail.consume(input, false);
		f.advance(AUTO_NUDGE_WINDOW_MS);
		await f.mail.flush();
		expect(f.timers.size).toBe(0);
		expect(f.writes).toHaveLength(1);
	} finally {
		await f.dispose();
	}
});

test("recipient read and ACK preserve explicit and inferred wake-batch reply ancestry", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("reply-after-consumption");
		await f.mail.flush();
		const item = f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items[0];
		assert.ok(item);
		const delivery = item.delivery;
		assert.ok(delivery.wakeBatchId);
		const consume = {
			teamId: f.teamId,
			actor: f.actor,
			deliveryId: delivery.id,
		};
		const reply = {
			teamId: f.teamId,
			actor: f.actor,
			to: "leader",
			type: "message",
			subject: "",
			body: "Accepted; task result follows separately",
			replyTo: sent.event.id,
			wakeBatchId: delivery.wakeBatchId,
			dedupeKey: "reply-after-read",
		};
		expect(f.mail.consume(consume, false).delivery.nudgeState).toBe("skipped");
		const afterRead = f.mail.send(reply);
		expect(afterRead.event).toMatchObject({
			wakeBatchId: delivery.wakeBatchId,
			hopCount: 1,
		});
		f.mail.consume(consume, true);
		const afterAck = f.mail.send({ ...reply, dedupeKey: "reply-after-ack" });
		expect(afterAck.event).toMatchObject({
			wakeBatchId: delivery.wakeBatchId,
			hopCount: 1,
		});
		expect(
			f.mail.send({ ...reply, dedupeKey: "reply-after-ack" }).event.id,
		).toBe(afterAck.event.id);
		const inferred = f.mail.send({
			...reply,
			wakeBatchId: undefined,
			dedupeKey: "inferred-after-ack",
		});
		expect(inferred.event).toMatchObject({
			wakeBatchId: delivery.wakeBatchId,
			hopCount: 1,
		});
		f.db
			.insert(teamMembers)
			.values({
				id: "other-recipient",
				teamId: f.teamId,
				name: "other",
				role: "worker",
				status: "active",
				agentId: "codex",
				operationId: "other-operation",
				requestFingerprint: "fixture",
				requestJson: "{}",
				taskSummary: "fixture",
				joinedAt: f.clock.now(),
			})
			.run();
		f.db
			.insert(mailDeliveries)
			.values({
				id: "other-delivery",
				eventId: sent.event.id,
				recipientMemberId: "other-recipient",
				nudgeState: "nudged",
				wakeBatchId: "other-batch",
				nudgedAt: f.clock.now(),
				createdAt: f.clock.now(),
				attemptCount: 1,
			})
			.run();
		expect(() =>
			f.mail.send({
				...reply,
				wakeBatchId: "other-batch",
				dedupeKey: "foreign-batch",
			}),
		).toThrow("Wake batch does not belong to this sender");
	} finally {
		await f.dispose();
	}
});

test.each([
	21, 257,
])("recipient can drain %d queued deliveries through stable CLI-sized pages", async (count) => {
	const f = mailFixture();
	try {
		for (let i = 0; i < count; i++) f.send(`drain-${i}`);
		let after: string | undefined;
		const seen = new Set<string>();
		for (;;) {
			const page = f.mail.inbox({
				teamId: f.teamId,
				actor: f.actor,
				limit: 20,
				after,
			});
			if (!page.items.length) break;
			for (const row of page.items) {
				expect(seen.has(row.delivery.id)).toBe(false);
				seen.add(row.delivery.id);
				f.mail.consume(
					{ teamId: f.teamId, actor: f.actor, deliveryId: row.delivery.id },
					false,
				);
				f.mail.consume(
					{ teamId: f.teamId, actor: f.actor, deliveryId: row.delivery.id },
					true,
				);
			}
			after = page.cursor ?? undefined;
		}
		expect(seen.size).toBe(count);
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items,
		).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});

test("two ignored notifications end in a real consumer fault after a later trusted idle", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("ignored");
		await f.mail.flush();
		f.advance(AUTO_NUDGE_WINDOW_MS);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		f.advance(AUTO_NUDGE_WINDOW_MS);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(sent).id))
				.get(),
		).toMatchObject({ nudgeState: "failed", ackedAt: null, attemptCount: 2 });
	} finally {
		await f.dispose();
	}
});

test("processing lease remains visible, expires without replay and requires a fresh recipient read before ACK", async () => {
	const f = mailFixture();
	try {
		const sent = f.send("lease"),
			input = {
				teamId: f.teamId,
				actor: f.actor,
				deliveryId: firstDelivery(sent).id,
			};
		expect(f.mail.consume(input, false).delivery.consumptionState).toBe(
			"processing",
		);
		f.advance(MAIL_PROCESSING_LEASE_MS + 1);
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items[0]?.delivery
				.consumptionState,
		).toBe("processing_overdue");
		expect(() => f.mail.consume(input, true)).toThrow("Read this delivery");
		f.mail.consume(input, false);
		expect(f.mail.consume(input, true).delivery.consumptionState).toBe(
			"acknowledged",
		);
		expect(f.writes).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});

test("busy queue waits for trusted idle, then drains more than one CLI page with explicit read and ACK", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		for (let i = 0; i < 25; i++) f.send(`page-${i}`);
		await f.mail.flush();
		expect(f.writes).toHaveLength(0);
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.all()
				.filter((row) => row.nudgeState === "nudged"),
		).toHaveLength(20);
		const first = f.mail.inbox({ teamId: f.teamId, actor: f.actor, limit: 20 });
		expect(first.items).toHaveLength(20);
		for (const row of first.items) {
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: row.delivery.id },
				false,
			);
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: row.delivery.id },
				true,
			);
		}
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		assert.ok(first.cursor);
		const next = f.mail.inbox({
			teamId: f.teamId,
			actor: f.actor,
			limit: 20,
			after: first.cursor,
		});
		expect(next.items).toHaveLength(5);
		for (const row of next.items) {
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: row.delivery.id },
				false,
			);
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: row.delivery.id },
				true,
			);
		}
		expect(f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items).toEqual(
			[],
		);
	} finally {
		await f.dispose();
	}
});

test("lost unread notification can be retried after fresh idle and durable backoff, but read processing is not replayed", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("missed");
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		f.advance(AUTO_NUDGE_WINDOW_MS);
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		f.mail.consume(
			{ teamId: f.teamId, actor: f.actor, deliveryId: firstDelivery(sent).id },
			false,
		);
		f.advance(AUTO_NUDGE_WINDOW_MS);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(2);
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items[0]?.delivery
				.ackedAt,
		).toBeNull();
	} finally {
		await f.dispose();
	}
});

test("same member recovery reactivates unavailable queue without touching uncertain deliveries", async () => {
	const f = mailFixture();
	try {
		f.db
			.update(teamMembers)
			.set({ status: "reconcile_required" })
			.where(eq(teamMembers.id, f.memberId))
			.run();
		const waiting = f.send("offline"),
			uncertain = f.send("uncertain");
		f.db
			.update(mailDeliveries)
			.set({ nudgeState: "uncertain_staged" })
			.where(eq(mailDeliveries.id, firstDelivery(uncertain).id))
			.run();
		await f.mail.flush();
		expect(firstDelivery(waiting).nudgeState).toBe("not_applicable");
		f.db
			.update(teamMembers)
			.set({ status: "active" })
			.where(eq(teamMembers.id, f.memberId))
			.run();
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(waiting).id))
				.get()?.nudgeState,
		).toBe("nudged");
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(uncertain).id))
				.get()?.nudgeState,
		).toBe("uncertain_staged");
	} finally {
		await f.dispose();
	}
});

test("no-ACK mail closes after recipient read, never after human view and never writes ackedAt", async () => {
	const f = mailFixture();
	try {
		const sent = f.send("optional", { requiresAck: false });
		const deliveryId = firstDelivery(sent).id;
		f.mail.consume({ teamId: f.teamId, deliveryId }, false);
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items,
		).toHaveLength(1);
		f.mail.consume({ teamId: f.teamId, actor: f.actor, deliveryId }, false);
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items,
		).toHaveLength(0);
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor, includeAcked: true })
				.items[0]?.delivery.ackedAt,
		).toBeNull();
	} finally {
		await f.dispose();
	}
});

test("no-ACK recipient read closes the inbox independently of uncertain notification audit", async () => {
	const f = mailFixture();
	try {
		const sent = f.send("uncertain-optional", { requiresAck: false }),
			deliveryId = firstDelivery(sent).id;
		f.db
			.update(mailDeliveries)
			.set({ nudgeState: "uncertain_staged" })
			.where(eq(mailDeliveries.id, deliveryId))
			.run();
		const read = f.mail.consume(
			{ teamId: f.teamId, actor: f.actor, deliveryId },
			false,
		);
		expect(read.delivery).toMatchObject({
			consumptionState: "read_no_ack",
			nudgeState: "uncertain_staged",
			ackedAt: null,
		});
		expect(
			f.mail.inbox({ teamId: f.teamId, actor: f.actor }).items,
		).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});

test("transport throwing after claim is immediately uncertain and is never auto-retried", async () => {
	let attempts = 0;
	const f = mailFixture({
		sendAutomatic: async (input) => {
			await input.acquireDelivery?.();
			attempts++;
			throw Error("transport unavailable");
		},
	});
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("throw");
		await f.mail.flush();
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(sent).id))
				.get(),
		).toMatchObject({ nudgeState: "uncertain_staged", inflightToken: null });
		f.advance(AUTO_NUDGE_WINDOW_MS);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		expect(attempts).toBe(1);
	} finally {
		await f.dispose();
	}
});

test("restart keeps successful-but-unread notifications recoverable without replaying their body", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		f.send("restart-unread");
		await f.mail.flush();
		await f.mail.dispose();
		let writes = 0;
		const restarted = new MailService(f.team, {
			now: f.clock.now,
			schedule: f.clock.schedule,
			sendAutomatic: async (input) => {
				const permit = f.store.acquireAutomaticDelivery(input.expectedAgent);
				const claim = await input.acquireDelivery?.();
				if (!permit?.isValid() || !claim?.isValid())
					return { kind: "SESSION_NOT_ACTIVE", error: "No permit" };
				expect(input.text).not.toContain("isolated task");
				writes++;
				return { success: true };
			},
		});
		f.advance(AUTO_NUDGE_WINDOW_MS);
		f.hook("Start");
		f.hook("Stop");
		await restarted.flush();
		expect(writes).toBe(1);
		await restarted.dispose();
	} finally {
		await f.dispose();
	}
});
