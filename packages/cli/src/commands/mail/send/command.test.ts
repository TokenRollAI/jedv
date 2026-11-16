import { afterEach, expect, test } from "bun:test";
import { withLocalHostService } from "../../../lib/host/test-helpers";
import send from "./command";

let modes: boolean | undefined;
let failure = false;
const calls: Record<string, unknown>[] = [];
withLocalHostService("mail-send-test", {
	"team.capabilities": () => ({
		protocolVersion: 1,
		...(modes === undefined
			? {}
			: { features: { mailDeliveryModes: modes, mailInterrupt: modes } }),
	}),
	"mail.send": (input) => {
		calls.push(input);
		if (failure) throw Error("unknown delivery outcome");
		return { event: { id: "event" } };
	},
});
afterEach(() => {
	modes = undefined;
	failure = false;
	calls.length = 0;
});
const run = (extra: Record<string, unknown> = {}) =>
	send.run({
		ctx: { config: { organizationId: "mail-send-test" } },
		signal: new AbortController().signal,
		args: {} as never,
		options: {
			team: "team",
			human: true,
			to: "leader",
			body: "keep exact draft",
			type: "message",
			dedupeKey: "stable-key",
			...extra,
		} as never,
	});

test("legacy queue remains compatible; explicit interrupt is refused on old Host before mutation", async () => {
	await run();
	expect(calls).toHaveLength(1);
	expect(calls[0]?.deliveryMode).toBeUndefined();
	calls.length = 0;
	await expect(run({ deliveryMode: "interrupt" })).rejects.toThrow(
		"does not support Mail delivery modes",
	);
	expect(calls).toHaveLength(0);
});
test("interrupt requires explicit human flag and preserves mode/ACK policy on supported Host", async () => {
	modes = true;
	await expect(
		run({ deliveryMode: "interrupt", human: false }),
	).rejects.toThrow("explicit user request");
	expect(calls).toHaveLength(0);
	await run({ deliveryMode: "interrupt", noAck: true });
	expect(calls[0]).toMatchObject({
		deliveryMode: "interrupt",
		requiresAck: false,
		dedupeKey: "stable-key",
		body: "keep exact draft",
	});
	expect(calls[0]?.actor).toBeUndefined();
});
test("optional ACK is refused on old Host and uncertain retry keeps the same request identity", async () => {
	await expect(run({ noAck: true })).rejects.toThrow(
		"does not support Mail delivery modes",
	);
	expect(calls).toHaveLength(0);
	modes = true;
	failure = true;
	await expect(run({ deliveryMode: "interrupt" })).rejects.toThrow(
		"unknown delivery outcome",
	);
	failure = false;
	await run({ deliveryMode: "interrupt" });
	expect(calls[0]).toEqual(calls[1]);
});
