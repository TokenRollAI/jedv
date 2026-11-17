import { describe, expect, test } from "bun:test";
import type { PaneActionConfig, RendererContext } from "../../types";
import { resolvePaneActionLabel } from "./utils";

const context = {} as RendererContext<unknown>;
const fallbacks = {
	splitRight: "Split right",
	splitDown: "Split down",
	close: "Close pane",
};

describe("resolvePaneActionLabel", () => {
	test("prefers explicit action.label over tooltip and key fallback", () => {
		const action: PaneActionConfig<unknown> = {
			key: "split-right",
			icon: null,
			label: "Custom split",
			tooltip: "Split Right",
			onClick: () => {},
		};
		expect(
			resolvePaneActionLabel(action, context, "Split Right", fallbacks),
		).toBe("Custom split");
	});

	test("uses string tooltip when explicit label is absent", () => {
		const action: PaneActionConfig<unknown> = {
			key: "close",
			icon: null,
			tooltip: "Close View",
			onClick: () => {},
		};
		expect(
			resolvePaneActionLabel(action, context, "Close View", fallbacks),
		).toBe("Close View");
	});

	test("falls back to localized labels for split-right, split-down, and close", () => {
		for (const [key, expected] of [
			["split-right", "Split right"],
			["split-down", "Split down"],
			["close", "Close pane"],
		] as const) {
			const action: PaneActionConfig<unknown> = {
				key,
				icon: null,
				onClick: () => {},
			};
			expect(
				resolvePaneActionLabel(action, context, undefined, fallbacks),
			).toBe(expected);
		}
	});
});
