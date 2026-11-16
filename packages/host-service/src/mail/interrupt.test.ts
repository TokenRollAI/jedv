import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mailDeliveries } from "../db/schema";
import {
	type InterruptExecution,
	interruptAndDeliver,
} from "../terminal/interrupt-agent";
import { mailRouter } from "../trpc/router/mail";
import { teamRouter } from "../trpc/router/team";
import { MailService } from "./service";
import { firstDelivery, mailFixture } from "./test-fixture";

test("advertised human interrupt keeps recipient-only consumption and causal replies through the router", async () => {
	let cancellations = 0;
	const f = mailFixture({
		resolveInterruptExecutable: async () => "/isolated/codex",
		sendInterrupt: async (input) => {
			const claim = await input.acquireDelivery();
			expect(claim?.isValid()).toBe(true);
			cancellations++;
			return { success: true, interruptConfirmed: true };
		},
	});
	try {
		const ctx = {
			...f.ctx,
			isAuthenticated: true,
			runtime: {
				...f.ctx.runtime,
				teamwork: {
					team: f.team,
					mail: f.mail,
					ready: Promise.resolve(),
				} as never,
			},
		};
		const caller = mailRouter.createCaller(ctx);
		expect(
			(await teamRouter.createCaller(ctx).capabilities()).features,
		).toMatchObject({
			mailDeliveryModes: true,
			mailInterrupt: process.platform === "darwin" && process.arch === "arm64",
		});
		f.hook("Start");
		const input = {
			teamId: f.teamId,
			to: "leader",
			deliveryMode: "interrupt" as const,
			body: "Handle the urgent request and report separately",
			dedupeKey: "human-router-interrupt",
		};
		await expect(
			caller.send({ ...input, actor: f.actor }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(cancellations).toBe(0);
		const sent = await caller.send(input);
		await f.mail.flush();
		const deliveryId = firstDelivery(sent).id;
		const diagnostic = await caller.read({ teamId: f.teamId, deliveryId });
		expect(diagnostic.delivery).toMatchObject({
			nudgeState: "nudged",
			readAt: null,
			ackedAt: null,
		});
		await expect(
			caller.ack({ teamId: f.teamId, deliveryId }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			caller.ack({ teamId: f.teamId, deliveryId, actor: f.actor }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		const received = await caller.read({
			teamId: f.teamId,
			deliveryId,
			actor: f.actor,
		});
		expect(received.delivery.receipt?.memberId).toBe(f.memberId);
		const acked = await caller.ack({
			teamId: f.teamId,
			deliveryId,
			actor: f.actor,
		});
		expect(acked.delivery.ackedAt).not.toBeNull();
		const reply = await caller.send({
			teamId: f.teamId,
			actor: f.actor,
			to: "leader",
			body: "Result recorded separately from receipt",
			replyTo: sent.event.id,
			wakeBatchId: received.delivery.wakeBatchId ?? undefined,
			dedupeKey: "human-router-reply",
		});
		expect(reply.event).toMatchObject({
			deliveryMode: "queue",
			requiresAck: true,
			replyToEventId: sent.event.id,
			wakeBatchId: received.delivery.wakeBatchId,
		});
		await caller.send(input);
		await f.mail.flush();
		expect(cancellations).toBe(1);
	} finally {
		await f.dispose();
	}
});

function fixture() {
	let valid = true,
		confirmed = false,
		dispatched = false,
		releases = 0;
	let listener = () => {},
		timeout = () => {};
	const controller = new AbortController();
	let entered!: () => void;
	const enteredCancel = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const writes: string[] = [];
	const input: InterruptExecution = {
		prepare: () => ({
			canDispatch: () => valid && !dispatched,
			markDispatched: () => {
				if (!valid || dispatched) return false;
				dispatched = true;
				return true;
			},
			isValid: () => valid,
			isConfirmed: () => valid && confirmed,
			release: () => {
				releases++;
			},
		}),
		current: () => valid,
		foreground: async () => true,
		claim: async () => ({ isValid: () => valid }),
		cancel: () => {
			writes.push("escape");
			entered();
		},
		deliver: async (isValid) => {
			if (!isValid()) return { kind: "SESSION_NOT_ACTIVE", error: "revoked" };
			writes.push("nudge");
			return { success: true };
		},
		observe: (fn) => {
			listener = fn;
			return () => {
				listener = () => {};
			};
		},
		schedule: (fn) => {
			timeout = fn;
			return () => {
				timeout = () => {};
			};
		},
		signal: controller.signal,
	};
	return {
		input,
		writes,
		controller,
		enteredCancel,
		confirm: () => {
			confirmed = true;
			listener();
		},
		revoke: () => {
			valid = false;
			listener();
		},
		timeout: () => timeout(),
		releases: () => releases,
	};
}
test("interrupt sends one cancellation and waits for trusted confirmation before Mail", async () => {
	const f = fixture();
	const pending = interruptAndDeliver(f.input);
	await f.enteredCancel;
	expect(f.writes).toEqual(["escape"]);
	f.confirm();
	expect(await pending).toEqual({ success: true, interruptConfirmed: true });
	expect(f.writes).toEqual(["escape", "nudge"]);
	expect(f.releases()).toBe(1);
});
test("cancellation timeout is uncertain and never submits Mail or retries cancellation", async () => {
	const f = fixture();
	const pending = interruptAndDeliver(f.input);
	await f.enteredCancel;
	f.timeout();
	expect(await pending).toMatchObject({ inputStaged: true });
	f.confirm();
	expect(f.writes).toEqual(["escape"]);
	expect(f.releases()).toBe(1);
});
test("manual input, session changes and shutdown revoke cancellation delivery", async () => {
	for (const abort of [false, true]) {
		const f = fixture();
		const pending = interruptAndDeliver(f.input);
		await f.enteredCancel;
		if (abort) f.controller.abort();
		else f.revoke();
		expect(await pending).toMatchObject({ inputStaged: true });
		expect(f.writes).toEqual(["escape"]);
	}
});
test("wrong foreground or protected draft cannot receive a cancellation key", async () => {
	const foreground = fixture();
	foreground.input.foreground = async () => false;
	expect(await interruptAndDeliver(foreground.input)).not.toHaveProperty(
		"inputStaged",
	);
	expect(foreground.writes).toEqual([]);
	const draft = fixture();
	draft.input.prepare = () => null;
	expect(await interruptAndDeliver(draft.input)).not.toHaveProperty(
		"inputStaged",
	);
	expect(draft.writes).toEqual([]);
});
test("a partial cancellation write is uncertain; post-confirmation delivery failure retains cancellation evidence", async () => {
	const broken = fixture();
	broken.input.cancel = () => {
		broken.writes.push("escape");
		throw Error("socket partial");
	};
	expect(await interruptAndDeliver(broken.input)).toMatchObject({
		inputStaged: true,
	});
	expect(broken.writes).toEqual(["escape"]);
	const staged = fixture();
	staged.input.deliver = async () => ({
		kind: "SESSION_NOT_ACTIVE",
		error: "draft arrived",
	});
	const pending = interruptAndDeliver(staged.input);
	await staged.enteredCancel;
	staged.confirm();
	expect(await pending).toMatchObject({
		inputStaged: true,
		interruptConfirmed: true,
	});
	expect(staged.writes).toEqual(["escape"]);
});
test("Mail interrupt claims durable delivery, uses exact source sequence and does not fake read or ACK", async () => {
	let calls = 0;
	const f = mailFixture({
		resolveInterruptExecutable: async () => "/isolated/codex",
		sendInterrupt: async (input) => {
			calls++;
			expect(input.expectedSourceSequence).toBe(1);
			const claim = await input.acquireDelivery();
			expect(claim?.isValid()).toBe(true);
			return { success: true, interruptConfirmed: true };
		},
	});
	try {
		f.hook("Start");
		const request = { deliveryMode: "interrupt" as const };
		const sent = f.send("interrupt", request);
		await f.mail.flush();
		expect(calls).toBe(1);
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(sent).id))
				.get(),
		).toMatchObject({
			nudgeState: "nudged",
			readAt: null,
			ackedAt: null,
			attemptCount: 1,
		});
		f.send("interrupt", request);
		await f.mail.flush();
		expect(calls).toBe(1);
	} finally {
		await f.dispose();
	}
});
test("interrupt transport uncertainty and host restart never repeat cancellation", async () => {
	let calls = 0;
	const f = mailFixture({
		resolveInterruptExecutable: async () => "/isolated/codex",
		sendInterrupt: async (input) => {
			calls++;
			await input.acquireDelivery();
			throw Error("unknown cancel result");
		},
	});
	try {
		f.hook("Start");
		const sent = f.send("uncertain-interrupt", { deliveryMode: "interrupt" });
		await f.mail.flush();
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(sent).id))
				.get()?.nudgeState,
		).toBe("uncertain_staged");
		const restarted = new MailService(f.team, {
			resolveInterruptExecutable: async () => "/isolated/codex",
			sendInterrupt: async () => {
				calls++;
				return { success: true, interruptConfirmed: true };
			},
		});
		restarted.start();
		await restarted.flush();
		expect(calls).toBe(1);
		await restarted.dispose();
	} finally {
		await f.dispose();
	}
});
test("interrupt finalization preserves concurrent recipient read receipts", async () => {
	let resolve!: (value: string | null) => void;
	let entered!: () => void;
	const gate = new Promise<void>((r) => {
		entered = r;
	});
	let calls = 0;
	const f = mailFixture({
		resolveInterruptExecutable: async () => {
			entered();
			return new Promise((r) => {
				resolve = r;
			});
		},
		sendInterrupt: async (input) => {
			calls++;
			const claim = await input.acquireDelivery();
			return claim?.isValid()
				? { success: true, interruptConfirmed: true }
				: { kind: "SESSION_NOT_ACTIVE", error: "already read" };
		},
	});
	try {
		f.hook("Start");
		const sent = f.send("read-race", { deliveryMode: "interrupt" });
		await gate;
		f.mail.consume(
			{ teamId: f.teamId, actor: f.actor, deliveryId: firstDelivery(sent).id },
			false,
		);
		resolve("/isolated/codex");
		await f.mail.flush();
		const inbox = f.mail.inbox({ teamId: f.teamId, actor: f.actor });
		expect(inbox.items[0]?.delivery.receipt?.memberId).toBe(f.memberId);
		expect(inbox.items[0]?.delivery.nudgeState).toBe("skipped");
		expect(calls).toBe(1);
	} finally {
		await f.dispose();
	}
});

test("an interrupt requested for an earlier busy interval cannot cancel a newer turn", async () => {
	let resolve!: (value: string | null) => void, entered!: () => void;
	const gate = new Promise<void>((r) => {
		entered = r;
	});
	let calls = 0;
	const f = mailFixture({
		resolveInterruptExecutable: async () => {
			entered();
			return new Promise((r) => {
				resolve = r;
			});
		},
		sendInterrupt: async () => {
			calls++;
			return { success: true, interruptConfirmed: true };
		},
	});
	try {
		f.hook("Start");
		const sent = f.send("old-interval", { deliveryMode: "interrupt" });
		await gate;
		f.hook("Stop");
		f.hook("Start");
		resolve("/isolated/codex");
		await f.mail.flush();
		expect(calls).toBe(0);
		expect(
			f.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, firstDelivery(sent).id))
				.get(),
		).toMatchObject({ nudgeState: "failed", attemptCount: 0, ackedAt: null });
	} finally {
		await f.dispose();
	}
});
