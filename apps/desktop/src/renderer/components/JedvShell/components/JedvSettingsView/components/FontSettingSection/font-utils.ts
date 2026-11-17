export const GENERIC_FAMILIES = new Set([
	"monospace",
	"sans-serif",
	"serif",
	"cursive",
	"fantasy",
	"system-ui",
	"ui-monospace",
]);

export const MONO_FALLBACK_STACK =
	"ui-monospace, SFMono-Regular, Menlo, monospace";

const EXCLUDED_SYMBOL_FONTS = new Set([
	"apple color emoji",
	"apple symbols",
	"bookshelf symbol 7",
	"marlett",
	"mt extra",
	"noto color emoji",
	"noto emoji",
	"segoe ui emoji",
	"segoe ui symbol",
	"symbol",
	"webdings",
	"wingdings",
	"wingdings 2",
	"wingdings 3",
	"zapf dingbats",
]);

/**
 * Returns true for symbol, dingbat, or emoji fonts that measure as fixed-width
 * on canvas but are unsuitable as monospace code/terminal fonts.
 */
export function isExcludedSymbolFont(family: string): boolean {
	const normalized = family.trim().toLowerCase();
	if (!normalized) return false;
	if (EXCLUDED_SYMBOL_FONTS.has(normalized)) return true;
	return /dingbat|wingding|webding|emoji|ornament|\bsymbols?\b/i.test(
		normalized,
	);
}

/**
 * Ensure a font-family CSS value always includes the monospace fallback stack.
 */
export function withMonospaceFallback(family: string): string {
	const trimmed = family.trim();
	if (!trimmed) return MONO_FALLBACK_STACK;
	if (trimmed.includes(",")) {
		return /\bmonospace\b/i.test(trimmed)
			? trimmed
			: `${trimmed}, ${MONO_FALLBACK_STACK}`;
	}
	if (GENERIC_FAMILIES.has(trimmed.toLowerCase())) {
		return trimmed.toLowerCase() === "monospace"
			? MONO_FALLBACK_STACK
			: `${trimmed}, ${MONO_FALLBACK_STACK}`;
	}
	const unquoted = trimmed.replace(/^["']|["']$/g, "");
	return `"${unquoted}", ${MONO_FALLBACK_STACK}`;
}

/**
 * Extract the first concrete (non-generic) family from a CSS font-family string.
 * Returns `null` if every entry is a generic family.
 */
export function parsePrimaryFamily(cssValue: string): string | null {
	const families: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (const ch of cssValue) {
		if (inQuote) {
			if (ch === inQuote) {
				inQuote = null;
			} else {
				current += ch;
			}
		} else if (ch === '"' || ch === "'") {
			inQuote = ch;
		} else if (ch === ",") {
			const trimmed = current.trim();
			if (trimmed) families.push(trimmed);
			current = "";
		} else {
			current += ch;
		}
	}
	const last = current.trim();
	if (last) families.push(last);

	return families.find((f) => !GENERIC_FAMILIES.has(f.toLowerCase())) ?? null;
}
