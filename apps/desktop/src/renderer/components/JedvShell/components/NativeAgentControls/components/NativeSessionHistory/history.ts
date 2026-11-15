import { emptySnapshot, reduceMany } from "@jedv/chat/core";
import { envelopeSchema } from "@jedv/chat/protocol";

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}
function textContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			const item = object(part);
			return typeof item?.text === "string" ? item.text : "";
		})
		.filter(Boolean)
		.join("\n");
}
export interface HistoryRecord {
	id: string;
	role: string;
	text: string;
}
export function nativeHistoryRecords(value: unknown): {
	source: "control-projection" | "native";
	records: HistoryRecord[];
} {
	const data = object(value);
	const projection = data?.source === "control-projection";
	let items: unknown[] = [];
	if (projection) {
		const page = object(data?.items);
		const envelopes = Array.isArray(page?.envelopes)
			? page.envelopes.flatMap((value) => {
					const parsed = envelopeSchema.safeParse(value);
					return parsed.success ? [parsed.data] : [];
				})
			: [];
		items = [...reduceMany(emptySnapshot(), envelopes).items.values()].map(
			(stored) => stored.item,
		);
	} else {
		const turns = Array.isArray(data?.data)
			? data.data
			: Array.isArray(data?.turns)
				? data.turns
				: [];
		items = turns.flatMap((turn) => {
			const row = object(turn);
			return Array.isArray(row?.items) ? row.items : [];
		});
	}
	return {
		source: projection ? "control-projection" : "native",
		records: items.flatMap((value, index) => {
			const item = object(value);
			if (!item) return [];
			const role = String(item.kind ?? item.type ?? "event");
			const text =
				typeof item.text === "string"
					? item.text
					: textContent(item.content) ||
						textContent(item.summary) ||
						[item.command, item.aggregatedOutput]
							.filter((part) => typeof part === "string")
							.join("\n");
			return text
				? [
						{
							id: typeof item.id === "string" ? item.id : String(index),
							role,
							text,
						},
					]
				: [];
		}),
	};
}
