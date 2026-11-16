import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { AUTO_NUDGE_WINDOW_MS } from "@jedv/shared/teamwork";
import { eq } from "drizzle-orm";
import { mailDeliveries } from "../db/schema";
import { MailService } from "./service";
import { firstDelivery, mailFixture } from "./test-fixture";

test.each([
	"pending",
	"inflight",
	"uncertain_staged",
	"skipped",
] as const)("a %s row without notification evidence cannot authorize a wake batch", async (state) => {
	const f = mailFixture();
	try {
		const sent = f.send(`no-notification-${state}`);
		f.db
			.update(mailDeliveries)
			.set({
				wakeBatchId: "unnotified-batch",
				nudgeState: state,
				nudgedAt: null,
			})
			.where(eq(mailDeliveries.id, firstDelivery(sent).id))
			.run();
		expect(() =>
			f.send("forged-reply", {
				actor: f.actor,
				wakeBatchId: "unnotified-batch",
			}),
		).toThrow("Wake batch does not belong to this sender");
	} finally {
		await f.dispose();
	}
});

test("legacy consumed notifications remain usable without accepting a stale caller launch", async () => {
	const f = mailFixture();
	try {
		const sent = f.send("legacy-notification");
		f.db
			.update(mailDeliveries)
			.set({
				wakeBatchId: "legacy-batch",
				nudgeState: "skipped",
				nudgedAt: f.clock.now(),
				attemptCount: 1,
			})
			.where(eq(mailDeliveries.id, firstDelivery(sent).id))
			.run();
		expect(
			f.send("legacy-reply", { actor: f.actor, wakeBatchId: "legacy-batch" })
				.event.hopCount,
		).toBe(1);
		expect(() =>
			f.send("stale-reply", {
				actor: { ...f.actor, launchId: "another-launch" },
				wakeBatchId: "legacy-batch",
			}),
		).toThrow();
	} finally {
		await f.dispose();
	}
});

test("failed re-notification cannot reuse an old timestamp as evidence; the earlier successful batch survives", async () => {
	let attempts = 0;
	const f = mailFixture({
		sendAutomatic: async (input) => {
			const idle = f.store.acquireAutomaticDelivery(input.expectedAgent),
				claim = await input.acquireDelivery?.();
			if (!idle?.isValid() || !claim?.isValid())
				return { kind: "SESSION_NOT_ACTIVE", error: "No permit" };
			return ++attempts === 1
				? { success: true }
				: {
						kind: "SESSION_NOT_ACTIVE",
						error: "Unknown second attempt",
						inputStaged: true,
					};
		},
	});
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("repeat-notification");
		await f.mail.flush();
		const original = f.db
			.select()
			.from(mailDeliveries)
			.where(eq(mailDeliveries.id, firstDelivery(sent).id))
			.get();
		assert.ok(original?.wakeBatchId);
		f.advance(AUTO_NUDGE_WINDOW_MS);
		f.hook("Start");
		f.hook("Stop");
		await f.mail.flush();
		const retry = f.db
			.select()
			.from(mailDeliveries)
			.where(eq(mailDeliveries.id, original.id))
			.get();
		assert.ok(retry?.wakeBatchId);
		expect(retry.nudgeState).toBe("uncertain_staged");
		expect(retry.nudgedAt).toBe(original.nudgedAt);
		expect(retry.wakeBatchId).not.toBe(original.wakeBatchId);
		expect(() =>
			f.send("failed-attempt-reply", {
				actor: f.actor,
				wakeBatchId: retry.wakeBatchId,
			}),
		).toThrow("Wake batch does not belong to this sender");
		expect(
			f.send("earlier-success-reply", {
				actor: f.actor,
				wakeBatchId: original.wakeBatchId,
			}).event.hopCount,
		).toBe(1);
	} finally {
		await f.dispose();
	}
});

test("successful batch provenance survives a MailService restart after recipient ACK", async () => {
	const f = mailFixture();
	try {
		f.hook("Start");
		f.hook("Stop");
		const sent = f.send("restart-batch");
		await f.mail.flush();
		const delivery = f.db
			.select()
			.from(mailDeliveries)
			.where(eq(mailDeliveries.id, firstDelivery(sent).id))
			.get();
		assert.ok(delivery?.wakeBatchId);
		const input = { teamId: f.teamId, actor: f.actor, deliveryId: delivery.id };
		f.mail.consume(input, false);
		f.mail.consume(input, true);
		await f.mail.dispose();
		const restarted = new MailService(f.team, {
			now: f.clock.now,
			schedule: f.clock.schedule,
			sendAutomatic: async () => ({
				kind: "SESSION_NOT_ACTIVE",
				error: "No test transport",
			}),
		});
		try {
			const reply = restarted.send({
				teamId: f.teamId,
				actor: f.actor,
				to: "leader",
				type: "message",
				subject: "",
				body: "Accepted",
				dedupeKey: "after-service-restart",
				wakeBatchId: delivery.wakeBatchId,
			});
			expect(reply.event).toMatchObject({
				wakeBatchId: delivery.wakeBatchId,
				hopCount: 1,
			});
		} finally {
			await restarted.dispose();
		}
	} finally {
		await f.dispose();
	}
});
