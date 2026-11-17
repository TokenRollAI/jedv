import { describe, expect, test } from "bun:test";
import type { PaneDefinition, RendererContext } from "../../../../../../types";
import { shouldShowPaneHeader } from "./utils";

const baseContext = {} as RendererContext<unknown>;

describe("shouldShowPaneHeader", () => {
	test("hides the redundant inner header for a single unsplit pane", () => {
		expect(
			shouldShowPaneHeader({
				paneCount: 1,
				parentDirection: null,
				hasCustomToolbar: false,
				context: baseContext,
			}),
		).toBe(false);
	});

	test("shows the header when the tab is split into multiple panes", () => {
		expect(
			shouldShowPaneHeader({
				paneCount: 2,
				parentDirection: "horizontal",
				hasCustomToolbar: false,
				context: baseContext,
			}),
		).toBe(true);
	});

	test("keeps a custom toolbar visible even on a single pane", () => {
		expect(
			shouldShowPaneHeader({
				paneCount: 1,
				parentDirection: null,
				hasCustomToolbar: true,
				context: baseContext,
			}),
		).toBe(true);
	});

	test("respects definition.hideHeader even when split", () => {
		const definition = {
			hideHeader: () => true,
		} as unknown as PaneDefinition<unknown>;
		expect(
			shouldShowPaneHeader({
				paneCount: 2,
				parentDirection: "vertical",
				hasCustomToolbar: false,
				definition,
				context: baseContext,
			}),
		).toBe(false);
	});
});
