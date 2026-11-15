import { expect, test } from "bun:test";
import { isCliControlBinding } from "./keyboard-binding";

test("macOS Control chords remain available to the CLI", () => {
	expect(
		isCliControlBinding({ version: 2, mode: "logical", chord: "ctrl+a" }, true),
	).toBe(true);
	expect(isCliControlBinding("ctrl+alt+w", true)).toBe(true);
	expect(isCliControlBinding("meta+ctrl+a", true)).toBe(false);
	expect(isCliControlBinding("ctrl+a", false)).toBe(false);
});
