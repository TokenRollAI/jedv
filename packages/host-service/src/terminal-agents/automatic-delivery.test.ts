import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup";
import { mapEventType } from "../events/map-event-type";
import { TerminalAgentStore } from "./store";
import type { TerminalAgentBinding } from "./types";

const identity = {
	terminalId: "terminal",
	workspaceId: "workspace",
	agentId: "claude" as const,
	launchId: "launch",
	agentSessionId: "session",
};

function createStore() {
	const store = new TerminalAgentStore(undefined, {
		readSourceSequence: () => 0,
	});
	store.recordEvent({ ...identity, eventType: "Attached", occurredAt: 1 });
	const expected = store.get(identity.terminalId);
	if (!expected) throw new Error("Missing fixture binding");
	const hook = (eventType: string, sequence: number, occurredAt = sequence) => {
		const mapped = mapEventType(eventType);
		if (!mapped) throw new Error("Unknown fixture hook");
		store.recordEvent({
			...identity,
			eventType: mapped,
			occurredAt,
			hook: { eventType, trusted: true, sequence },
		});
	};
	const idle = () => {
		hook("Start", 1);
		hook("Stop", 2);
	};
	return { store, expected, hook, idle };
}

describe("automatic delivery authority", () => {
	it("a Host-owned fresh launch may deliver after tool progress without falsely trusting agy PreInvocation as user input", () => {
		const store = new TerminalAgentStore(undefined, {
			readSourceSequence: () => 0,
		});
		const launch = { ...identity, agentId: "agy" as const };
		expect(store.recordManagedAgentLaunch(launch)).toBe(true);
		store.recordEvent({ ...launch, eventType: "Attached", occurredAt: 1 });
		const binding = store.get(launch.terminalId);
		if (!binding) throw new Error("Missing binding");
		expect(store.getNativeInputStatus(binding)).toBe("clean");
		store.recordEvent({
			...launch,
			eventType: "Start",
			occurredAt: 2,
			hook: { eventType: "Start", trusted: true, sequence: 1 },
		});
		store.recordEvent({
			...launch,
			eventType: "Start",
			occurredAt: 3,
			hook: { eventType: "PostToolUse", trusted: true, sequence: 2 },
		});
		store.recordEvent({
			...launch,
			eventType: "Stop",
			occurredAt: 4,
			hook: { eventType: "Stop", trusted: true, sequence: 3 },
		});
		expect(store.acquireAutomaticDelivery(binding)?.isValid()).toBe(true);
		store.invalidateTerminalInput(launch.terminalId);
		expect(store.recordManagedAgentLaunch(launch)).toBe(false);
		store.recordEvent({
			...launch,
			eventType: "Start",
			occurredAt: 5,
			hook: { eventType: "Start", trusted: true, sequence: 4 },
		});
		store.recordEvent({
			...launch,
			eventType: "Stop",
			occurredAt: 6,
			hook: { eventType: "Stop", trusted: true, sequence: 5 },
		});
		expect(store.getNativeInputStatus(binding)).toBe("manual-input");
		expect(store.acquireAutomaticDelivery(binding)).toBeNull();
	});
	it("input before the first binding revokes the Host-owned clean launch proof", () => {
		const store = new TerminalAgentStore(undefined, {
			readSourceSequence: () => 0,
		});
		const launch = { ...identity, agentId: "agy" as const };
		store.recordManagedAgentLaunch(launch);
		store.invalidateTerminalInput(launch.terminalId);
		store.recordEvent({ ...launch, eventType: "Attached", occurredAt: 1 });
		const binding = store.get(launch.terminalId);
		if (!binding) throw new Error("Missing binding");
		store.recordEvent({
			...launch,
			eventType: "Start",
			occurredAt: 2,
			hook: { eventType: "Start", trusted: true, sequence: 1 },
		});
		store.recordEvent({
			...launch,
			eventType: "Stop",
			occurredAt: 3,
			hook: { eventType: "Stop", trusted: true, sequence: 2 },
		});
		expect(store.getNativeInputStatus(binding)).toBe("manual-input");
		expect(store.acquireAutomaticDelivery(binding)).toBeNull();
	});
	it.each([
		"different-launch",
		"evicted-proof",
		"ended-proof",
		"failed-launch",
	])("%s cannot inherit a clean buffer from another launch", (change) => {
		const store = new TerminalAgentStore(undefined, {
			readSourceSequence: () => 0,
		});
		const launch = { ...identity, agentId: "agy" as const };
		store.recordManagedAgentLaunch(launch);
		if (change === "evicted-proof")
			for (let i = 0; i < 256; i++)
				store.recordManagedAgentLaunch({ ...launch, terminalId: `other-${i}` });
		if (change === "ended-proof") store.markTerminalExited(launch.terminalId);
		if (change === "failed-launch") store.forgetManagedAgentLaunch(launch);
		const actual = {
			...launch,
			launchId: change === "different-launch" ? "replacement" : launch.launchId,
		};
		store.recordEvent({ ...actual, eventType: "Attached", occurredAt: 1 });
		const binding = store.get(launch.terminalId);
		if (!binding) throw new Error("Missing binding");
		expect(store.getNativeInputStatus(binding)).toBe("unknown");
		store.recordEvent({
			...actual,
			eventType: "Start",
			occurredAt: 2,
			hook: { eventType: "Start", trusted: true, sequence: 1 },
		});
		store.recordEvent({
			...actual,
			eventType: "Stop",
			occurredAt: 3,
			hook: { eventType: "Stop", trusted: true, sequence: 2 },
		});
		expect(store.acquireAutomaticDelivery(binding)).toBeNull();
	});
	it.each([
		"agy",
		"gemini",
	] as const)("%s legacy per-tool Start cannot prove the input buffer is clean", (agentId) => {
		const store = new TerminalAgentStore(undefined, {
			readSourceSequence: () => 0,
		});
		const binding = {
			...identity,
			agentId,
			startedAt: 1,
			lastEventAt: 1,
			lastEventType: "Attached",
		};
		store.recordEvent({ ...binding, eventType: "Attached", occurredAt: 1 });
		store.recordEvent({
			...binding,
			eventType: "Start",
			occurredAt: 2,
			hook: { eventType: "Start", trusted: true, sequence: 1 },
		});
		store.invalidateAutomaticDelivery(binding);
		store.recordEvent({
			...binding,
			eventType: "Start",
			occurredAt: 3,
			hook: { eventType: "Start", trusted: true, sequence: 2 },
		});
		store.recordEvent({
			...binding,
			eventType: "Stop",
			occurredAt: 4,
			hook: { eventType: "Stop", trusted: true, sequence: 3 },
		});
		expect(store.acquireAutomaticDelivery(binding)).toBeNull();
	});
	it.each([
		"PostToolUse",
		"PostToolUseFailure",
		"PermissionResult",
		"AfterTool",
		"pre_tool",
		"before_tool",
	])("a hand-written draft survives fresh %s and Stop without authorizing a nudge", (toolEvent) => {
		const { store, expected, hook } = createStore();
		hook("Start", 1);
		store.invalidateAutomaticDelivery(expected);
		hook(toolEvent, 2);
		hook("Stop", 3);
		expect(store.getAutomaticDeliveryState(expected)).not.toBe("idle");
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
	});
	it("a tool completion without a hand-written draft may complete its observed turn", () => {
		const { store, expected, hook } = createStore();
		hook("Start", 1);
		hook("PostToolUse", 2);
		hook("Stop", 3);
		expect(store.acquireAutomaticDelivery(expected)?.isValid()).toBe(true);
	});
	it("a draft revokes a claimed permit and later tool progress cannot issue a replacement", () => {
		const { store, expected, hook, idle } = createStore();
		idle();
		const original = store.acquireAutomaticDelivery(expected);
		expect(original?.isValid()).toBe(true);
		store.invalidateAutomaticDelivery(expected);
		hook("PostToolUse", 3);
		hook("Stop", 4);
		expect(original?.isValid()).toBe(false);
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
	});
	it("only a fresh genuine prompt submission clears a hand-written draft before later automatic delivery", () => {
		const { store, expected, hook } = createStore();
		hook("Start", 1);
		store.invalidateAutomaticDelivery(expected);
		hook("PostToolUse", 2);
		hook("Stop", 3);
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		hook("UserPromptSubmit", 4);
		hook("PostToolUse", 5);
		hook("Stop", 6);
		expect(store.acquireAutomaticDelivery(expected)?.isValid()).toBe(true);
	});
	it("tool-only and legacy untrusted Start cannot establish a clean input buffer", () => {
		const { store, expected, hook } = createStore();
		hook("PostToolUse", 1);
		hook("Stop", 2);
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		store.recordEvent({ ...identity, eventType: "Start", occurredAt: 3 });
		hook("PostToolUse", 4);
		hook("Stop", 5);
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
	});
	it("restores only the producer watermark and rejects hooks generated before host boot", () => {
		const terminalId = randomUUID();
		const directory = join(resolveAppHomeDir(), "state/hook-sequences");
		mkdirSync(directory, { recursive: true });
		const counter = join(directory, `${terminalId}.launch`);
		writeFileSync(counter, "10\n");
		const binding: TerminalAgentBinding = {
			...identity,
			terminalId,
			deliverySequence: 2,
			startedAt: 1,
			lastEventAt: 2,
			lastEventType: "Stop",
		};
		try {
			const store = new TerminalAgentStore({
				load: () => [binding],
				upsert: () => {},
				delete: () => {},
			});
			const hook = (eventType: string, sequence: number) =>
				store.recordEvent({
					...binding,
					eventType,
					occurredAt: 1000 + sequence,
					hook: { eventType, sequence, trusted: true },
				});
			hook("Start", 9);
			hook("Stop", 10);
			expect(store.acquireAutomaticDelivery(binding)).toBeNull();
			hook("Start", 11);
			hook("Stop", 12);
			expect(store.acquireAutomaticDelivery(binding)?.isValid()).toBe(true);
		} finally {
			rmSync(counter);
		}
	});
	it("does not authorize display Stop, legacy hooks, or an unobserved work interval", () => {
		for (const hook of [
			undefined,
			{ eventType: "Stop", trusted: true },
			{ eventType: "Stop", trusted: false, sequence: 2 },
			{ eventType: "Stop", trusted: true, sequence: 2 },
		]) {
			const { store, expected } = createStore();
			store.recordEvent({
				...identity,
				eventType: "Stop",
				occurredAt: 100,
				hook,
			});
			expect(store.get(identity.terminalId)?.lastEventType).toBe("Stop");
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		}
	});

	it("claims an idle interval once, including retries with a newer receipt timestamp", () => {
		const { store, expected, hook, idle } = createStore();
		idle();
		const permit = store.acquireAutomaticDelivery(expected);
		expect(permit?.isValid()).toBe(true);
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		hook("Stop", 2, 1000);
		expect(permit?.isValid()).toBe(true);
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		hook("Start", 3);
		expect(permit?.isValid()).toBe(false);
		hook("Stop", 2, 2000);
		expect(store.getAutomaticDeliveryState(expected)).toBe("working");
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		hook("Stop", 4);
		expect(store.acquireAutomaticDelivery(expected)?.isValid()).toBe(true);
	});

	for (const change of ["clear", "permission", "interrupt"] as const) {
		it(`${change} revokes a permit and late Stop cannot re-arm it`, () => {
			const { store, expected, hook, idle } = createStore();
			idle();
			const permit = store.acquireAutomaticDelivery(expected);
			if (change === "clear") {
				store.clearWorkspaceStatuses(identity.workspaceId);
				expect(store.get(identity.terminalId)?.lastEventType).toBe("Stop");
				expect(store.get(identity.terminalId)?.lastEventAt).toBe(2);
			} else
				hook(change === "permission" ? "PermissionRequest" : "Interrupt", 3);
			expect(permit?.isValid()).toBe(false);
			hook("Stop", 2, 1000);
			hook("Stop", 4, 2000);
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
			expect(store.getAutomaticDeliveryState(expected)).toBe(
				change === "clear"
					? "cleared"
					: change === "permission"
						? "permission"
						: "interrupted",
			);
			// The ignored Stop still advances the producer watermark.
			hook("Start", 3, 3000);
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
			hook("Start", 5);
			hook("Stop", 6);
			expect(store.acquireAutomaticDelivery(expected)?.isValid()).toBe(true);
		});
	}

	it("does not turn repeated idle Stop into a second permit after an uncertain send", () => {
		const { store, expected, hook, idle } = createStore();
		idle();
		store.acquireAutomaticDelivery(expected);
		for (const sequence of [2, 3, 4]) hook("Stop", sequence, 1000 + sequence);
		expect(store.getAutomaticDeliveryState(expected)).toBe("reserved");
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
	});

	it("keeps loaded Stop unknown, even after a delayed Attached and Stop", () => {
		const persisted: TerminalAgentBinding = {
			...identity,
			startedAt: 1,
			lastEventAt: 2,
			lastEventType: "Stop",
		};
		const store = new TerminalAgentStore({
			load: () => [persisted],
			upsert: () => {},
			delete: () => {},
		});
		store.recordEvent({ ...identity, eventType: "Attached", occurredAt: 3 });
		store.recordEvent({
			...identity,
			eventType: "Stop",
			occurredAt: 100,
			hook: { eventType: "Stop", trusted: true, sequence: 10 },
		});
		expect(store.getAutomaticDeliveryState(persisted)).toBe("unknown");
		expect(store.acquireAutomaticDelivery(persisted)).toBeNull();
	});

	for (const change of [
		"launch",
		"session",
		"workspace",
		"end",
		"manual",
	] as const) {
		it(`invalidates a claimed permit on ${change}`, () => {
			const { store, expected, idle } = createStore();
			idle();
			const permit = store.acquireAutomaticDelivery(expected);
			if (change === "end") store.markTerminalExited(identity.terminalId);
			else if (change === "manual") store.invalidateAutomaticDelivery(expected);
			else
				store.recordEvent({
					...identity,
					eventType: "Attached",
					occurredAt: 3,
					...(change === "launch" ? { launchId: "replacement" } : {}),
					...(change === "session" ? { agentSessionId: "replacement" } : {}),
					...(change === "workspace" ? { workspaceId: "other" } : {}),
				});
			expect(permit?.isValid()).toBe(false);
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		});
	}

	it("does not treat Failed, unknown or mismatched raw hooks as trusted idle", () => {
		for (const eventType of ["Failed", "unknown", "Stop"]) {
			const { store, expected, idle } = createStore();
			idle();
			const permit = store.acquireAutomaticDelivery(expected);
			store.recordEvent({
				...identity,
				eventType,
				occurredAt: 3,
				hook: {
					eventType: eventType === "Stop" ? "PermissionRequest" : eventType,
					trusted: true,
					sequence: 3,
				},
			});
			expect(permit?.isValid()).toBe(false);
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		}
	});
});
