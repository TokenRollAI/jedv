import { redactProjectError } from "../../../JedvProjectActions/project-utils";

const redact = (value: unknown, depth = 0): unknown => {
	if (depth > 12) return "[…]";
	if (typeof value === "string")
		return redactProjectError(value)
			.replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
			.replace(/\bsk-[\w-]+/g, "[redacted]");
	if (Array.isArray(value))
		return value.slice(0, 100).map((item) => redact(item, depth + 1));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.slice(0, 100)
				.map(([key, item]) => [
					key,
					/secret|password|token|credential|authorization|api.?key|cookie/i.test(
						key,
					)
						? "[redacted]"
						: redact(item, depth + 1),
				]),
		);
	return value;
};
export function toolOutput(content: string) {
	try {
		const data = JSON.parse(content);
		const name =
			typeof data.tool === "string"
				? data.tool
				: typeof data.toolName === "string"
					? data.toolName
					: null;
		const normalized =
			data.status === "succeeded"
				? "success"
				: data.status === "failed"
					? "error"
					: data.status;
		const status = ["running", "success", "error", "interrupted"].includes(
			normalized,
		)
			? (normalized as "running" | "success" | "error" | "interrupted")
			: data.error || data.result?.error
				? "error"
				: name && "result" in data
					? "success"
					: null;
		return { name, status, detail: JSON.stringify(redact(data), null, 2) };
	} catch {
		// Older Hosts may have truncated JSON. Do not expose an unredactable fragment.
		return { name: null, status: null, detail: null };
	}
}
