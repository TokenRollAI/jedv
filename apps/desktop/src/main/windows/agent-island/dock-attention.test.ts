import { expect, test } from "bun:test";
import type { AgentIslandEntry } from "shared/types/agent-island";
import { DockAttention, type DockBadgeState } from "./dock-attention";

const entry: AgentIslandEntry = {
	entryId: "one",
	workspaceId: "w",
	workspaceName: "W",
	projectName: "P",
	provider: "codex",
	profileHash: "profile",
	nativeSessionId: "native",
	terminalId: "t",
	activeWriter: "control",
	leaseEpoch: 2,
	turnState: "awaiting-approval",
	completedUnread: false,
	pendingApprovals: [{ requestId: "r", method: "approval" }],
};
test("Dock unions windows by host/native identity and never resurrects a lower lease after close", () => {
	const writes: DockBadgeState[] = [];
	const dock = new DockAttention({
		write: (state) => writes.push(state),
		visible: () => false,
	});
	dock.publish(1, "host-a", [entry]);
	dock.publish(2, "host-a", [
		{ ...entry, entryId: "duplicate", workspaceId: "other-workspace" },
	]);
	expect(dock.state().count).toBe(1);
	expect(writes).toHaveLength(1);
	dock.publish(3, "host-b", [entry]);
	expect(dock.state().count).toBe(2);
	dock.publish(2, "host-a", [
		{
			...entry,
			leaseEpoch: 1,
			pendingApprovals: [{ requestId: "stale", method: "approval" }],
		},
	]);
	expect(dock.state().count).toBe(2);
	dock.clear(1);
	expect(dock.state().count).toBe(1);
	dock.clear(3);
	expect(dock.state().count).toBe(0);
	expect(writes.every((state) => state.bounce === false)).toBe(true);
});
test("only actual visibility advances shared read floor; stale unread and repeated snapshots stay read", () => {
	let visible = false;
	const writes: DockBadgeState[] = [];
	const dock = new DockAttention({
		write: (state) => writes.push(state),
		visible: () => visible,
	});
	const completed: AgentIslandEntry = {
		...entry,
		turnState: "idle",
		completedUnread: true,
		pendingApprovals: [],
		attention: {
			event: { kind: "completed", marker: "Stop:20", occurredAt: 20 },
			observedAt: 20,
			readThrough: 9999,
		},
	};
	dock.publish(1, "host", [completed]);
	expect(dock.state().count).toBe(1);
	expect(dock.readThrough(1).one).toBe(0);
	dock.publish(2, "host", [{ ...completed, entryId: "duplicate" }]);
	expect(dock.state().count).toBe(1);
	visible = true;
	dock.reconcile();
	expect(dock.state().count).toBe(0);
	expect(dock.readThrough(1).one).toBe(20);
	visible = false;
	dock.publish(2, "host", [{ ...completed, entryId: "duplicate" }]);
	expect(dock.state().count).toBe(0);
	const count = writes.length;
	dock.publish(1, "host", [completed]);
	expect(writes).toHaveLength(count);
	dock.publish(1, "host", [
		{
			...completed,
			attention: {
				event: { kind: "completed", marker: "Stop:30", occurredAt: 30 },
				observedAt: 30,
				readThrough: 0,
			},
		},
	]);
	expect(dock.state().count).toBe(1);
});
test("uncertain identity or missing markers uses a dot, never a fabricated total or bounce, and windows are bounded", () => {
	let visible = false;
	const dock = new DockAttention({ write: () => {}, visible: () => visible });
	dock.publish(1, "host", [{ ...entry, profileHash: null }]);
	expect(dock.state()).toEqual({ count: 0, dot: true, bounce: false });
	visible = true;
	dock.reconcile();
	expect(dock.state().dot).toBe(false);
	visible = false;
	dock.publish(1, "host", [
		{
			...entry,
			profileHash: null,
			pendingApprovals: [{ requestId: "new", method: "approval" }],
		},
	]);
	expect(dock.state().dot).toBe(true);
	dock.clear(1);
	for (let id = 1; id <= 20; id++) dock.publish(id, "host", []);
	expect(() => dock.publish(21, "host", [entry])).toThrow("window limit");
});
