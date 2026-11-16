import { expect, test } from "bun:test";
import { mapEventType } from "../events/map-event-type";
import { TerminalAgentStore } from "./store";

const identity = {
	terminalId: "terminal",
	workspaceId: "workspace",
	agentId: "codex" as const,
	launchId: "launch",
	agentSessionId: "session",
};

function fixture() {
	let watermark: number | null = 0;
	const store = new TerminalAgentStore(undefined, {
		readSourceSequence: () => watermark,
	});
	store.recordEvent({ ...identity, eventType: "Attached", occurredAt: 1 });
	const binding = store.get(identity.terminalId);
	if (!binding) throw new Error("Missing fixture binding");
	const hook = (eventType: string, sequence: number, trusted = true) => {
		watermark = sequence;
		const mapped = mapEventType(eventType);
		if (!mapped) throw new Error("Unknown fixture hook");
		store.recordEvent({
			...identity,
			eventType: mapped,
			occurredAt: sequence + 10,
			hook: { eventType, sequence, trusted },
		});
	};
	return {
		store,
		binding,
		hook,
		watermark: (value: number | null) => {
			watermark = value;
		},
	};
}

test("only a dispatched interruption receives fresh trusted confirmation, never an automatic idle permit", () => {
	const f = fixture();
	f.hook("Start", 1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	expect(attempt?.canDispatch()).toBe(true);
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	expect(attempt?.isConfirmed()).toBe(false);
	expect(attempt?.markDispatched()).toBe(true);
	expect(attempt?.markDispatched()).toBe(false);
	f.hook("Interrupt", 2);
	expect(attempt?.isValid()).toBe(true);
	expect(attempt?.isConfirmed()).toBe(true);
	expect(f.store.getAutomaticDeliveryState(f.binding)).toBe("interrupted");
	expect(f.store.acquireAutomaticDelivery(f.binding)).toBeNull();
	attempt?.release();
	expect(attempt?.isValid()).toBe(false);
});

test("a hand-written draft remains dirty across PostToolUse and only a new prompt clears it", () => {
	const f = fixture();
	f.hook("Start", 1);
	f.store.invalidateAutomaticDelivery(f.binding);
	f.hook("PostToolUse", 2);
	expect(f.store.getAutomaticDeliveryState(f.binding)).toBe("working");
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	f.hook("Start", 3);
	expect(f.store.prepareNativeInterrupt(f.binding)?.canDispatch()).toBe(true);
});

test("a prompt generated before manual input cannot clear the draft latch", () => {
	const f = fixture();
	f.hook("Start", 1);
	f.watermark(2);
	f.store.invalidateAutomaticDelivery(f.binding);
	f.hook("Start", 2);
	f.hook("PostToolUse", 3);
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	f.hook("Start", 4);
	expect(f.store.prepareNativeInterrupt(f.binding)?.canDispatch()).toBe(true);
});

test("a failed manual-input watermark sample fails closed until a later genuine prompt", () => {
	const f = fixture();
	f.hook("Start", 1);
	f.watermark(null);
	f.store.invalidateAutomaticDelivery(f.binding);
	f.hook("Start", 2);
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	f.hook("PostToolUse", 3);
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	f.hook("Start", 4);
	expect(f.store.prepareNativeInterrupt(f.binding)?.canDispatch()).toBe(true);
});

test.each([
	"untrusted",
	"stale",
	"before-dispatch",
])("%s Interrupt does not confirm cancellation", (kind) => {
	const f = fixture();
	f.hook("Start", 1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	if (kind !== "before-dispatch") expect(attempt?.markDispatched()).toBe(true);
	f.hook("Interrupt", kind === "stale" ? 1 : 2, kind !== "untrusted");
	expect(attempt?.isConfirmed()).toBe(false);
	expect(f.store.acquireAutomaticDelivery(f.binding)).toBeNull();
});

test.each([
	"untrusted",
	"stale",
])("%s Interrupt cannot replace trusted working status with interrupted", (kind) => {
	const f = fixture();
	f.hook("Start", 1);
	f.hook("Interrupt", kind === "stale" ? 1 : 2, kind !== "untrusted");
	expect(f.store.getAutomaticDeliveryState(f.binding)).not.toBe("interrupted");
});

test("pending producer events or unreadable producer state prevent the cancel key", () => {
	const f = fixture();
	f.hook("Start", 1);
	f.watermark(2);
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	f.watermark(null);
	expect(f.store.prepareNativeInterrupt(f.binding)).toBeNull();
	f.watermark(1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	f.watermark(2);
	expect(attempt?.canDispatch()).toBe(false);
	expect(attempt?.markDispatched()).toBe(false);
});

test.each([
	"manual",
	"clear",
	"new-prompt",
	"launch",
	"session",
	"exit",
	"permission",
])("%s invalidates a dispatched cancel attempt", (change) => {
	const f = fixture();
	f.hook("Start", 1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	expect(attempt?.markDispatched()).toBe(true);
	if (change === "manual") f.store.invalidateAutomaticDelivery(f.binding);
	if (change === "clear") f.store.clearWorkspaceStatuses(identity.workspaceId);
	if (change === "new-prompt") f.hook("Start", 2);
	if (change === "permission") f.hook("PermissionRequest", 2);
	if (change === "exit") f.store.markTerminalExited(identity.terminalId);
	if (change === "launch" || change === "session")
		f.store.recordEvent({
			...identity,
			launchId: change === "launch" ? "another-launch" : identity.launchId,
			agentSessionId:
				change === "session" ? "another-session" : identity.agentSessionId,
			eventType: "Attached",
			occurredAt: 100,
		});
	expect(attempt?.isValid()).toBe(false);
	expect(attempt?.isConfirmed()).toBe(false);
});

test("manual input after cancellation acknowledgement revokes message delivery", () => {
	const f = fixture();
	f.hook("Start", 1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	attempt?.markDispatched();
	f.hook("Interrupt", 2);
	expect(attempt?.isConfirmed()).toBe(true);
	f.store.invalidateAutomaticDelivery(f.binding);
	expect(attempt?.isConfirmed()).toBe(false);
});

test("a manual-input listener sees the cancel attempt revoked before any callback can write", () => {
	const f = fixture();
	f.hook("Start", 1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	attempt?.markDispatched();
	let validDuringSignal: boolean | undefined;
	f.store.on("manual-input", () => {
		validDuringSignal = attempt?.isValid();
	});
	f.store.invalidateAutomaticDelivery(f.binding);
	expect(validDuringSignal).toBe(false);
});

test("a pending new prompt after cancellation cannot race message delivery", () => {
	const f = fixture();
	f.hook("Start", 1);
	const attempt = f.store.prepareNativeInterrupt(f.binding);
	attempt?.markDispatched();
	f.hook("Interrupt", 2);
	f.watermark(3);
	expect(attempt?.isConfirmed()).toBe(false);
	f.hook("Start", 3);
	expect(attempt?.isValid()).toBe(false);
});

test("restored display working state and unsupported providers do not authorize interruption", () => {
	const f = fixture();
	f.hook("Start", 1);
	const stored = f.store.get(identity.terminalId);
	if (!stored) throw new Error("Missing binding");
	const restored = new TerminalAgentStore(
		{ load: () => [stored], upsert: () => {}, delete: () => {} },
		{ readSourceSequence: () => 1 },
	);
	expect(restored.prepareNativeInterrupt(stored)).toBeNull();
	expect(
		f.store.prepareNativeInterrupt({ ...f.binding, agentId: "claude" }),
	).toBeNull();
});
