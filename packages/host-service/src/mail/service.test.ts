import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mailDeliveries, mailEvents, teams } from "../db/schema";
import { networkFixture } from "../peers/test-fixture";
import { fingerprint } from "../teams/service";
import { MailService } from "./service";
import { firstDelivery, mailFixture } from "./test-fixture";

test("queue defaults preserve legacy dedupe and persist ACK policy without acknowledging consumption", async () => {
	const f = mailFixture();
	try {
		const input = {
			teamId: f.teamId,
			to: "leader",
			type: "message",
			subject: "",
			body: "process",
			dedupeKey: "queue",
		};
		const sent = f.mail.send(input);
		expect(sent.event).toMatchObject({
			deliveryMode: "queue",
			requiresAck: true,
		});
		expect(sent.event.requestFingerprint).toBe(
			fingerprint({ ...input, actor: undefined }),
		);
		expect(
			f.mail.send({ ...input, deliveryMode: "queue", requiresAck: true }).event
				.id,
		).toBe(sent.event.id);
		expect(() => f.mail.send({ ...input, requiresAck: false })).toThrow(
			"different content",
		);
		const delivery = firstDelivery(sent);
		const read = f.mail.consume(
			{ teamId: f.teamId, deliveryId: delivery.id },
			false,
		);
		expect(read.delivery.readAt).toBeNull();
		expect(read.delivery.ackedAt).toBeNull();
		expect(read.delivery.nudgeState).toBe("pending");
		const optional = f.mail.send({
			...input,
			dedupeKey: "optional",
			requiresAck: false,
		});
		expect(optional.event.requiresAck).toBe(false);
		expect(firstDelivery(optional).ackedAt).toBeNull();
		expect(() =>
			f.mail.consume({ teamId: f.teamId, deliveryId: delivery.id }, true),
		).toThrow("Only the current recipient");
		expect(() =>
			f.mail.consume(
				{ teamId: f.teamId, actor: f.actor, deliveryId: delivery.id },
				true,
			),
		).toThrow("Read this delivery");
		f.mail.consume(
			{ teamId: f.teamId, actor: f.actor, deliveryId: delivery.id },
			false,
		);
		const ack = f.mail.consume(
			{ teamId: f.teamId, actor: f.actor, deliveryId: delivery.id },
			true,
		);
		expect(ack.delivery.ackedAt).not.toBeNull();
	} finally {
		await f.dispose();
	}
});

test("unsupported interrupt is rejected without queueing, writes or metadata spoofing", async () => {
	const f = networkFixture();
	try {
		f.db
			.update(teams)
			.set({ status: "active" })
			.where(eq(teams.id, f.teamId))
			.run();
		const input = {
			teamId: f.teamId,
			to: "leader",
			type: "message",
			subject: "",
			body: "process",
			dedupeKey: "interrupt",
		};
		expect(() => f.mail.send({ ...input, deliveryMode: "interrupt" })).toThrow(
			"Safe interruption is unavailable",
		);
		expect(f.db.select().from(mailEvents).all()).toHaveLength(0);
		expect(() =>
			f.mail.send({
				...input,
				payload: { _jedvMail: { deliveryMode: "interrupt" } },
			}),
		).toThrow("reserved");
		expect(f.db.select().from(mailEvents).all()).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});

test("restart preserves uncertain delivery without replaying or fabricating ACK", async () => {
	const f = networkFixture();
	try {
		const input = {
			teamId: f.teamId,
			to: "leader",
			type: "message",
			subject: "",
			body: "process",
			dedupeKey: "restart",
		};
		const sent = f.mail.send(input);
		const delivery = firstDelivery(sent);
		f.db
			.update(mailDeliveries)
			.set({
				nudgeState: "inflight",
				inflightToken: "claimed",
				attemptCount: 1,
			})
			.where(eq(mailDeliveries.id, delivery.id))
			.run();
		let sends = 0;
		const restarted = new MailService(f.team, {
			sendAutomatic: async () => {
				sends++;
				return { success: true };
			},
		});
		restarted.start();
		await restarted.flush();
		const again = restarted.send(input);
		await restarted.flush();
		expect(again.event.id).toBe(sent.event.id);
		expect(again.deliveries[0]).toMatchObject({
			nudgeState: "uncertain_staged",
			readAt: null,
			ackedAt: null,
			attemptCount: 1,
		});
		expect(sends).toBe(0);
		await restarted.dispose();
	} finally {
		await f.dispose();
	}
});
