export function deriveProjectNameFromUrl(url: string): string {
	const trimmed = url
		.trim()
		.replace(/[?#].*$/, "")
		.replace(/[\\/]+$/, "")
		.replace(/\.git$/i, "");
	return (
		trimmed
			.split(/[/:\\]/)
			.filter(Boolean)
			.at(-1) ?? ""
	);
}
export function isRepositorySource(value: string): boolean {
	const source = value.trim();
	if (!source || /[\r\n\0]/.test(source) || source.startsWith("-"))
		return false;
	if (/^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(source)) return true;
	if (/^[\w.-]+@[\w.-]+:.+/.test(source))
		return !/^git@github\.com:.*[?#]/i.test(source);
	try {
		const url = new URL(source);
		if (url.hostname.toLowerCase() === "github.com" && (url.search || url.hash))
			return false;
		return (
			["http:", "https:", "ssh:", "git:", "file:"].includes(url.protocol) &&
			(url.protocol === "file:" || !!url.hostname)
		);
	} catch {
		return false;
	}
}
export function directoryNameForProject(name: string): string {
	return name
		.trim()
		.replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}
export function joinProjectPath(parent: string, name: string): string {
	const separator = /^[A-Za-z]:\\|^\\\\/.test(parent) ? "\\" : "/";
	return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}
export function redactProjectError(value: string): string {
	return value
		.replace(/\b(?:https?|ssh|git):\/\/[^\s'"<>]+/gi, (raw) => {
			try {
				const url = new URL(raw);
				url.username = "";
				url.password = "";
				url.search = "";
				url.hash = "";
				return url.toString();
			} catch {
				return "[repository]";
			}
		})
		.replace(
			/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
			"[redacted]",
		);
}

export function isAbsoluteHostPath(value: string): boolean {
	return (
		/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim()) && !/[\r\n\0]/.test(value)
	);
}
