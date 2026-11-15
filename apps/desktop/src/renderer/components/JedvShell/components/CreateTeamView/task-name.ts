export function taskTeamName(task: string, override = "", fallback = "") {
	const title =
		override.trim() ||
		task
			.trim()
			.split(/[\r\n.!?。！？]/u)
			.find((part) => part.trim())
			?.trim() ||
		fallback.trim();
	return Array.from(title).slice(0, 120).join("");
}
