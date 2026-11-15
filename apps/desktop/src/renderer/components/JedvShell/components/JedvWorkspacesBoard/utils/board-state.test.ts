import { expect, test } from "bun:test";
import { boardColumn } from "./board-state";

test("board uses protocol events and PR state, with explicit unread acknowledgement", () => {
	const workspace = { archivedAt: null, archiveReason: null };
	expect(boardColumn(workspace, [], null)).toBe("idle");
	expect(boardColumn(workspace, [{ lastEventType: "Attached" }], null)).toBe(
		"idle",
	);
	expect(boardColumn(workspace, [{ lastEventType: "Start" }], null)).toBe(
		"working",
	);
	expect(boardColumn(workspace, [{ lastEventType: "Stop" }], null)).toBe(
		"finished",
	);
	expect(boardColumn(workspace, [{ lastEventType: "Stop" }], null, 123)).toBe(
		"idle",
	);
	expect(
		boardColumn(
			workspace,
			[{ lastEventType: "Stop" }, { lastEventType: "PermissionRequest" }],
			null,
		),
	).toBe("attention");
	expect(
		boardColumn(workspace, [{ lastEventType: "Start", endedAt: 10 }], null),
	).toBe("idle");
	expect(boardColumn(workspace, [{ lastEventType: "Failed" }], null)).toBe(
		"attention",
	);
	const pr = {
		url: "https://github.com/fixture/repo/pull/7",
		number: 7,
		title: "Fixture",
		state: "open" as const,
		checksStatus: "none" as const,
		checks: [],
		reviewDecision: null,
		mergedAt: null,
	};
	expect(boardColumn(workspace, [], pr)).toBe("review");
	expect(
		boardColumn(workspace, [{ lastEventType: "PermissionRequest" }], {
			...pr,
			state: "merged",
		}),
	).toBe("merged");
	expect(boardColumn({ archivedAt: 1, archiveReason: "deleted" }, [], pr)).toBe(
		"deleted",
	);
});
