import { describe, expect, test } from "bun:test";
import { leaderboardPayloadInput, MAX_BACKFILL_DAYS } from "./usage";

const accepts = (days: number) =>
	leaderboardPayloadInput.safeParse({ days }).success;

describe("leaderboardPayloadInput", () => {
	test("accepts the 30-day window", () => {
		expect(accepts(30)).toBe(true);
	});

	test("accepts the ceiling exactly", () => {
		expect(accepts(MAX_BACKFILL_DAYS)).toBe(true);
	});

	test("rejects past the ceiling", () => {
		expect(accepts(MAX_BACKFILL_DAYS + 1)).toBe(false);
	});

	test("rejects a non-window", () => {
		expect(accepts(0)).toBe(false);
		expect(accepts(-1)).toBe(false);
		expect(accepts(1.5)).toBe(false);
	});
});
