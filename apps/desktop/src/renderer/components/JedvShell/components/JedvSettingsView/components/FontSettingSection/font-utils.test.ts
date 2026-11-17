import { describe, expect, test } from "bun:test";
import {
	isExcludedSymbolFont,
	MONO_FALLBACK_STACK,
	withMonospaceFallback,
} from "./font-utils";

describe("isExcludedSymbolFont", () => {
	test("excludes symbol, dingbat, and emoji fonts", () => {
		for (const family of [
			"Webdings",
			"Wingdings",
			"Wingdings 2",
			"Zapf Dingbats",
			"Apple Color Emoji",
			"Apple Symbols",
			"Symbol",
			"Noto Color Emoji",
		]) {
			expect(isExcludedSymbolFont(family)).toBe(true);
		}
	});

	test("keeps monospace programming fonts", () => {
		for (const family of [
			"JetBrains Mono",
			"Menlo",
			"FiraCode Nerd Font",
			"SF Mono",
		]) {
			expect(isExcludedSymbolFont(family)).toBe(false);
		}
	});
});

describe("withMonospaceFallback", () => {
	test("appends standard monospace fallback stack to single font family", () => {
		expect(withMonospaceFallback("JetBrains Mono")).toBe(
			`"JetBrains Mono", ${MONO_FALLBACK_STACK}`,
		);
		expect(withMonospaceFallback('"SF Mono"')).toBe(
			`"SF Mono", ${MONO_FALLBACK_STACK}`,
		);
	});

	test("preserves stacks that already end with monospace", () => {
		const stack = "ui-monospace, Menlo, Consolas, Liberation Mono, monospace";
		expect(withMonospaceFallback(stack)).toBe(stack);
	});
});
