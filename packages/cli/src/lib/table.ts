const URL_CELL = /^https?:\/\/\S+$/;

const graphemeSegmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

const supportsHyperlinks = () =>
	process.stdout.isTTY === true && process.env.TERM !== "dumb";

/**
 * OSC 8 hyperlink, for terminals that honour it. A terminal that does not
 * falls back to detecting links in the text it can see, which is why a URL
 * cell is never truncated: the visible text has to stand on its own.
 */
function hyperlink(url: string, label: string): string {
	if (!supportsHyperlinks()) return label;
	return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}

interface Cell {
	/** What the reader sees, and what the column is measured against. */
	text: string;
	/** Full target when `text` is a possibly-truncated URL. */
	link?: string;
}

function truncateToWidth(str: string, maxWidth: number): string {
	if (Bun.stringWidth(str) <= maxWidth) return str;
	if (maxWidth <= 1) return maxWidth === 1 ? "…" : "";
	let out = "";
	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(str)) {
		const segmentWidth = Bun.stringWidth(segment);
		if (width + segmentWidth + 1 > maxWidth) break;
		out += segment;
		width += segmentWidth;
	}
	return `${out}…`;
}

function padEndWidth(str: string, targetWidth: number): string {
	const pad = Math.max(0, targetWidth - Bun.stringWidth(str));
	return str + " ".repeat(pad);
}

/**
 * Format tabular CLI output using terminal display width (`Bun.stringWidth`)
 * so wide CJK/emoji characters align cleanly with ASCII columns.
 */
export function table(
	data: Record<string, unknown>[],
	columns: string[],
	headers?: string[],
	maxColWidth: number | (number | undefined)[] = 60,
): string {
	if (data.length === 0) return "No results.";

	const caps = columns.map((_, i) =>
		Array.isArray(maxColWidth) ? (maxColWidth[i] ?? 60) : maxColWidth,
	);
	const hdrs = headers ?? columns.map((c) => c.toUpperCase());
	const rows = data.map((row) =>
		columns.map((col, i): Cell => {
			const val = getNestedValue(row, col);
			const str = val === null || val === undefined ? "—" : String(val);
			const cap = caps[i]!;
			if (URL_CELL.test(str)) return { text: str, link: str };
			return { text: truncateToWidth(str, cap) };
		}),
	);

	const widths = hdrs.map((h, i) =>
		Math.max(
			Bun.stringWidth(h),
			...rows.map((r) => Bun.stringWidth(r[i]?.text ?? "")),
		),
	);

	const headerLine = hdrs.map((h, i) => padEndWidth(h, widths[i]!)).join("  ");
	const bodyLines = rows.map((r) =>
		r
			.map((cell, i) => {
				const padding = " ".repeat(
					Math.max(0, widths[i]! - Bun.stringWidth(cell.text)),
				);
				const body = cell.link ? hyperlink(cell.link, cell.text) : cell.text;
				return body + padding;
			})
			.join("  "),
	);

	return [headerLine, ...bodyLines].join("\n");
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce<unknown>((acc, key) => {
		if (typeof acc === "object" && acc !== null && key in acc) {
			return (acc as Record<string, unknown>)[key];
		}
		return undefined;
	}, obj);
}
