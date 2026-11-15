import { expect, test } from "bun:test";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import { collapsedMemberLimit, memberNeedsAttention } from "./TeamMemberGrid";

test("member collapse limits show three on narrow layouts and two rows elsewhere, with real hidden anomaly classification", () => {
	expect(collapsedMemberLimit(1)).toBe(3);
	expect(collapsedMemberLimit(2)).toBe(3);
	expect(collapsedMemberLimit(4)).toBe(8);
	expect(
		memberNeedsAttention({
			status: "active",
			deliveryState: "idle",
		} as TeamMember),
	).toBe(false);
	expect(
		memberNeedsAttention({
			status: "active",
			deliveryState: "permission",
		} as TeamMember),
	).toBe(true);
	expect(
		memberNeedsAttention({ status: "reconcile_required" } as TeamMember),
	).toBe(true);
});
