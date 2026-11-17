const SMART_TITLE_MAX_CHARS = 35;

function smartTruncateTitle(
	raw: string,
	maxChars = SMART_TITLE_MAX_CHARS,
): string {
	const compact = raw.trim().replace(/\s+/g, " ");
	const chars = Array.from(compact);
	if (chars.length <= maxChars) return compact;
	const slice = chars.slice(0, Math.max(1, maxChars - 1)).join("");
	const match = slice.match(/^(.*?)[\s,;:、，；：]+[^\s,;:、，；：]*$/u);
	const cut =
		match?.[1] && match[1].length >= Math.floor(slice.length * 0.4)
			? match[1]
			: slice;
	return `${cut.replace(/[\s,;:、，；：]+$/u, "")}…`;
}

export function taskTeamName(task: string, override = "", fallback = "") {
	const explicit = override.trim();
	if (explicit) return Array.from(explicit).slice(0, 120).join("");
	const derived =
		task
			.trim()
			.split(/[\r\n.!?。！？]/u)
			.find((part) => part.trim())
			?.trim() || fallback.trim();
	return derived ? smartTruncateTitle(derived) : "";
}
