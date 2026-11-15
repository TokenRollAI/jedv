import { expect, test } from "bun:test";
import type { AgentIslandEntry } from "shared/types/agent-island";
import type { Workspace } from "../../types";
import { applyAttentionReadThrough } from "./attention";
import { bindingAttentionEvent, snapshotEntry } from "./snapshot";

test("completion markers come from the matching native binding, never polling transitions or backfill", () => {
	const state = {
		provider: "codex" as const,
		nativeSessionId: "native",
		profileHash: "profile",
		terminalId: "t",
		activeWriter: "cli" as const,
		leaseEpoch: 2,
		turnState: "idle" as const,
		pendingApprovals: [],
	};
	const workspace = { id: "w", name: "W", branch: "branch" } as Workspace;
	const binding = {
		agentId: "codex",
		agentSessionId: "native",
		lastEventType: "Stop",
		lastEventAt: 10,
	};
	const baseline = snapshotEntry({
		entryId: "e",
		state,
		workspace,
		event: bindingAttentionEvent(binding, "codex", "native"),
	});
	expect(baseline.completedUnread).toBe(false);
	const running = snapshotEntry({
		entryId: "e",
		state: { ...state, turnState: "running" },
		workspace,
		previous: baseline,
		event: bindingAttentionEvent(
			{ ...binding, lastEventType: "Start", lastEventAt: 20 },
			"codex",
			"native",
		),
	});
	const completed = snapshotEntry({
		entryId: "e",
		state,
		workspace,
		previous: running,
		event: bindingAttentionEvent(
			{ ...binding, lastEventAt: 30 },
			"codex",
			"native",
		),
	});
	expect(completed.completedUnread).toBe(true);
	expect(completed.attention?.event?.marker).toBe("Stop:30");
	const unmarked = snapshotEntry({
		entryId: "e",
		state,
		workspace,
		previous: {
			...running,
			attention: { event: null, observedAt: 0, readThrough: 0 },
		},
		event: null,
	});
	expect(unmarked.completedUnread).toBe(true);
	expect(unmarked.attention?.event).toBeNull();
	expect(
		applyAttentionReadThrough([unmarked], [unmarked], {}, ["e"])[0]
			.completedUnread,
	).toBe(false);
	expect(bindingAttentionEvent(binding, "claude", "native")).toBeNull();
	expect(bindingAttentionEvent(binding, "codex", "different")).toBeNull();
	const [read] = applyAttentionReadThrough([completed], [completed], { e: 30 });
	expect(read.completedUnread).toBe(false);
	const replacement: AgentIslandEntry = {
		...completed,
		nativeSessionId: "new-native",
	};
	expect(
		applyAttentionReadThrough([replacement], [completed], { e: 999 })[0],
	).toBe(replacement);
});
