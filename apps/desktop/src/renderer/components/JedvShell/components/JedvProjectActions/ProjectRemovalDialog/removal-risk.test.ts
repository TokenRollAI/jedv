import { expect, test } from "bun:test";
import { removalRiskFingerprint } from "./removal-risk";

test("project removal risk ignores heartbeats and ordering but detects new destructive risks", () => {
	const base = {
		rows: [{ id: "w", dirty: true, unpushed: false, blocked: false }],
		impact: [
			{
				workspaceId: "w",
				runningTerminalCount: 1,
				runningAgentCount: 1,
				lastActiveAt: 1,
			},
		],
	};
	const heartbeat = {
		...base,
		impact: [{ ...base.impact[0], lastActiveAt: 999 }],
	};
	expect(removalRiskFingerprint(base)).toBe(removalRiskFingerprint(heartbeat));
	expect(removalRiskFingerprint(base)).not.toBe(
		removalRiskFingerprint({
			...base,
			impact: [{ ...base.impact[0], runningTerminalCount: 2 }],
		}),
	);
});
