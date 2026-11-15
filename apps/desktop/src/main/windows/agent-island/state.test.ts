import { expect, test } from "bun:test";
import {
	type AgentIslandEntry,
	agentIslandSnapshotSchema,
} from "shared/types/agent-island";
import {
	AgentIslandProjection,
	islandActivityCounts,
	islandPopoverBounds,
} from "./state";

const entry: AgentIslandEntry = {
	entryId: "entry",
	workspaceId: "workspace",
	workspaceName: "Workspace",
	projectName: "Project",
	provider: "codex",
	nativeSessionId: "native",
	profileHash: "profile",
	terminalId: "terminal",
	activeWriter: "control",
	leaseEpoch: 1,
	turnState: "awaiting-approval",
	completedUnread: false,
	pendingApprovals: [
		{ requestId: "approval", method: "item/commandExecution/requestApproval" },
	],
};
const approval = {
	entryId: "entry",
	hostId: "host",
	profileHash: "profile",
	nativeSessionId: "native",
	expectedLeaseEpoch: 1,
	requestId: "approval",
	decision: "accept" as const,
};

test("Island only forwards a current Control approval once and clears host-bound work on rebinding", () => {
	const projection = new AgentIslandProjection();
	projection.bind(1, "host");
	projection.publish(1, "host", [entry]);
	expect(() => projection.publish(2, "host", [entry])).toThrow(
		"binding changed",
	);
	for (const patch of [
		{ hostId: "other-host" },
		{ profileHash: "other-profile" },
		{ nativeSessionId: "other" },
		{ expectedLeaseEpoch: 2 },
		{ requestId: "not-pending" },
	])
		expect(() => projection.approve({ ...approval, ...patch })).toThrow(
			"changed",
		);
	const forwarded = projection.approve(approval);
	expect(forwarded).toMatchObject({
		hostId: "host",
		nativeSessionId: "native",
		profileHash: "profile",
		expectedLeaseEpoch: 1,
	});
	projection.publish(1, "host", [entry]);
	expect(() => projection.approve(approval)).toThrow("already forwarded");
	expect(() => projection.complete(2, forwarded.actionId)).toThrow(
		"binding changed",
	);
	projection.complete(1, forwarded.actionId);
	expect(() => projection.complete(1, forwarded.actionId)).toThrow(
		"already completed",
	);
	projection.bind(1, "next-host");
	expect(projection.entries).toEqual([]);
	expect(() => projection.approve(approval)).toThrow("no longer exists");
	projection.publish(1, "next-host", [{ ...entry, activeWriter: "cli" }]);
	expect(() => projection.approve(approval)).toThrow("CLI terminal");
});

test("Island snapshots reject oversized, duplicated and unknown fields", () => {
	const snapshot = { hostId: "host", entries: [entry] };
	expect(agentIslandSnapshotSchema.safeParse(snapshot).success).toBe(true);
	for (const entries of [
		Array.from({ length: 33 }, (_, index) => ({
			...entry,
			entryId: String(index),
		})),
		[entry, entry],
		[{ ...entry, summary: "a".repeat(513) }],
		[
			{
				...entry,
				pendingApprovals: [
					...entry.pendingApprovals,
					...entry.pendingApprovals,
				],
			},
		],
		[{ ...entry, psk: "secret" }],
	])
		expect(
			agentIslandSnapshotSchema.safeParse({ hostId: "host", entries }).success,
		).toBe(false);
});

test("menu bar activity counts real snapshot states and anchors a popup inside the tray display", () => {
	expect(islandActivityCounts([])).toEqual({
		running: 0,
		approvals: 0,
		completed: 0,
	});
	expect(
		islandActivityCounts([
			entry,
			{
				...entry,
				entryId: "running",
				turnState: "running",
				pendingApprovals: [],
			},
			{
				...entry,
				entryId: "completed",
				turnState: "idle",
				pendingApprovals: [],
				completedUnread: true,
			},
		]),
	).toEqual({ running: 1, approvals: 1, completed: 1 });
	const area = { x: -1440, y: 38, width: 1440, height: 830 };
	expect(
		islandPopoverBounds(area, { x: -40, y: 0, width: 20, height: 38 }),
	).toEqual({ x: -380, y: 44, width: 380, height: 280 });
	expect(
		islandPopoverBounds(area, { x: -1500, y: 900, width: 20, height: 30 }),
	).toEqual({ x: -1440, y: 588, width: 380, height: 280 });
});
