import { expect, test } from "bun:test";
import type { AutoUpdateStatusEvent } from "shared/auto-update";
import { updateDisplayState } from "./update-state";

test("only a supported successful check reports the installed version as current", () => {
	const event: AutoUpdateStatusEvent = {
		status: "idle",
		currentVersion: "2.0.8",
		releasesUrl: "https://github.com/TokenRollAI/jedv/releases",
		channel: "stable",
		availability: "supported",
		checkOutcome: "not-checked",
		installing: false,
	};
	expect(updateDisplayState(event)).toBe("not-checked");
	expect(
		updateDisplayState({
			...event,
			checkOutcome: "update-available",
			version: "2.0.9",
		}),
	).toBe("deferred");
	expect(updateDisplayState({ ...event, checkOutcome: "up-to-date" })).toBe(
		"up-to-date",
	);
	for (const availability of [
		"development",
		"unpackaged",
		"unsigned",
		"missing-metadata",
	] as const) {
		expect(
			updateDisplayState({
				...event,
				availability,
				checkOutcome: "up-to-date",
			}),
		).toBe("unavailable");
	}
	expect(
		updateDisplayState({
			...event,
			status: "error",
			checkOutcome: "failed",
			errorKind: "feed",
		}),
	).toBe("error");
	expect(
		updateDisplayState({ ...event, status: "ready", installing: true }),
	).toBe("installing");
});
