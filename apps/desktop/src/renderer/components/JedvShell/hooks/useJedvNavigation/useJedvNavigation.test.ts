import { expect, test } from "bun:test";
import { jedvNavigationSchema } from "shared/main-events";
import { parseNavigation } from "./useJedvNavigation";

test("collapsed group navigation defaults legacy state, bounds stored keys and preserves original host isolation", () => {
	const original = JSON.stringify([
		"http://original.invalid",
		"project",
		"tag:中文",
	]);
	const other = JSON.stringify([
		"http://different.invalid",
		"project",
		"tag:中文",
	]);
	const legacy = {
		hostUrl: null,
		workspaceId: null,
		terminalId: null,
		sidebarCollapsed: false,
		collapsedProjects: [],
	};
	expect(jedvNavigationSchema.parse(legacy).collapsedGroups).toEqual([]);
	expect(
		jedvNavigationSchema.safeParse({
			...legacy,
			collapsedGroups: Array(129).fill(original),
		}).success,
	).toBe(false);
	expect(
		jedvNavigationSchema.safeParse({
			...legacy,
			collapsedGroups: ["x".repeat(4097)],
		}).success,
	).toBe(false);
	expect(
		parseNavigation(
			JSON.stringify({
				...legacy,
				collapsedGroups: [
					original,
					original,
					other,
					null,
					42,
					"x".repeat(4097),
				],
			}),
		).collapsedGroups,
	).toEqual([original, other]);
	expect(
		parseNavigation(
			JSON.stringify({
				...legacy,
				collapsedGroups: Array.from({ length: 140 }, (_, index) =>
					String(index),
				),
			}),
		).collapsedGroups,
	).toHaveLength(128);
});
