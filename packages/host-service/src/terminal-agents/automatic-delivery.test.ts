import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup";
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
	const hook = (eventType: string, sequence: number, occurredAt = sequence) =>
		store.recordEvent({
			...identity,
			eventType: eventType === "Interrupt" ? "Stop" : eventType,
			occurredAt,
			hook: { eventType, trusted: true, sequence },
		});
	const idle = () => {
		hook("Start", 1);
		hook("Stop", 2);
	};
	return { store, expected, hook, idle };
}

describe("automatic delivery authority", () => {
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
