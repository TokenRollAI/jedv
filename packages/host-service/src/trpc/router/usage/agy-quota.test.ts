import { describe, expect, it } from "bun:test";
import { mapAgyQuotaWindows } from "./agy-quota";

describe("mapAgyQuotaWindows", () => {
	it("maps the four stable session and weekly buckets", () => {
		const windows = mapAgyQuotaWindows({
			groups: [
				{
					buckets: [
						{
							bucketId: "gemini-weekly",
							remainingFraction: 0.98,
							resetTime: "2026-09-01T00:00:00Z",
						},
						{
							bucketId: "gemini-5h",
							remainingFraction: 0.875,
							resetTime: "2026-08-28T20:00:00Z",
						},
					],
				},
				{
					buckets: [
						{ bucketId: "3p-weekly", remainingFraction: 0.75 },
						{ bucketId: "3p-5h", remainingFraction: 0.5 },
					],
				},
			],
		});
		expect(windows.map(({ id, usedPercent }) => [id, usedPercent])).toEqual([
			["gemini-5h", 13],
			["gemini-weekly", 2],
			["3p-5h", 50],
			["3p-weekly", 25],
		]);
	});

	it("preserves varying Gemini bucket IDs alongside 3p buckets", () => {
		const windows = mapAgyQuotaWindows({
			groups: [
				{
					buckets: [
						{ bucketId: "3p-5h", remainingFraction: 0.4 },
						{ bucketId: "3p-weekly", remainingFraction: 0.8 },
					],
				},
				{
					groupId: "gemini-models",
					displayName: "Gemini Models",
					buckets: [
						{ bucketId: "gemini-pro-5h", remainingFraction: 0.9 },
						{
							bucketId: "gemini-flash-weekly",
							remainingFraction: 0.25,
							resetTime: "2026-09-02T00:00:00Z",
						},
						{
							bucketId: "gemini-argon",
							label: "Gemini Argon",
							remainingFraction: 0.5,
						},
						{ bucketId: "", remainingFraction: 0.5 },
						{ bucketId: "broken", remainingFraction: Number.NaN },
					],
				},
			],
		});
		expect(
			windows.map(({ id, label, usedPercent }) => [id, label, usedPercent]),
		).toEqual([
			["gemini-pro-5h", "Session — Gemini Pro", 10],
			["gemini-flash-weekly", "Weekly — Gemini Flash", 75],
			["gemini-argon", "Gemini Argon", 50],
			["3p-5h", "Session — Claude and GPT Models", 60],
			["3p-weekly", "Weekly — Claude and GPT Models", 20],
		]);
	});
});
