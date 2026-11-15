import { expect, test } from "bun:test";
import { shouldShowReleaseCard } from "./release-card";

test("local release card appears only for an undismissed upgrade", () => {
	expect(shouldShowReleaseCard("2.0.8", null, null)).toBe(false);
	expect(shouldShowReleaseCard("2.0.8", "2.0.8", null)).toBe(false);
	expect(shouldShowReleaseCard("2.0.8", "2.0.7", null)).toBe(true);
	expect(shouldShowReleaseCard("2.0.7", "2.0.8", null)).toBe(false);
	expect(shouldShowReleaseCard("2.0.8", "2.0.8-canary.1", null)).toBe(true);
	expect(shouldShowReleaseCard("2.0.8", "2.0.7", "2.0.8")).toBe(false);
});
