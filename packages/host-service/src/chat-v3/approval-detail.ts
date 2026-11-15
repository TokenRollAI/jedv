import { sanitizePromptForPty } from "@jedv/shared/agent-prompt-launch";

export type NativeApprovalDetail = {
	command?: string;
	cwd?: string;
	paths?: string[];
	reason?: string;
	permissions?: string[];
	redacted: boolean;
	truncated: boolean;
};

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function approvalDetail(value: unknown): NativeApprovalDetail {
	const input = record(value);
	const result: NativeApprovalDetail = { redacted: false, truncated: false };
	const text = (value: unknown, limit: number): string | undefined => {
		if (typeof value !== "string" || !value.trim()) return undefined;
		result.truncated ||= value.length > 65_536;
		const cleaned = sanitizePromptForPty(value.slice(0, 65_536))
			.replace(
				/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
				"[redacted private key]",
			)
			.replace(
				/(\b(?:authorization|proxy-authorization)\s*:\s*)(?:Bearer|Basic)\s+[^\s'";]+/gi,
				"$1[redacted]",
			)
			.replace(
				/(\b(?:[\w-]*(?:token|password|passwd|secret|api[_-]?key|access[_-]?key)[\w-]*)\s*(?:=|:|\s)\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s;&|]+)/gi,
				"$1[redacted]",
			)
			.replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
			.replace(
				/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
				"[redacted]",
			)
			.replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
		result.redacted ||= cleaned !== value;
		result.truncated ||= cleaned.length > limit;
		return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
	};
	const strings = (value: unknown, limit: number): string[] | undefined => {
		if (!Array.isArray(value)) return undefined;
		result.truncated ||= value.length > 20;
		const values = value.slice(0, 20).flatMap((entry) => {
			const clean = text(entry, limit);
			return clean ? [clean] : [];
		});
		return values.length ? [...new Set(values)] : undefined;
	};
	result.command = text(input.command, 4096);
	result.cwd = text(input.cwd, 1024);
	result.reason = text(input.reason, 1024);
	result.paths = strings(input.paths, 1024);
	result.permissions = strings(input.permissions, 256);
	return result;
}

export function codexApprovalDetail(
	params: unknown,
	item?: NativeApprovalDetail,
): NativeApprovalDetail {
	const input = record(params);
	const detail = approvalDetail({
		command: input.command ?? item?.command,
		cwd: input.cwd ?? item?.cwd,
		reason: input.reason,
		paths: item?.paths,
		permissions:
			typeof input.grantRoot === "string" ? [input.grantRoot] : undefined,
	});
	detail.redacted ||= item?.redacted ?? false;
	detail.truncated ||= item?.truncated ?? false;
	return detail;
}

export function codexItemApprovalDetail(value: unknown): NativeApprovalDetail {
	const item = record(value);
	const changes =
		item.type === "fileChange" && Array.isArray(item.changes)
			? item.changes
			: [];
	const result = approvalDetail({
		command: item.type === "commandExecution" ? item.command : undefined,
		cwd: item.cwd,
		paths: changes.slice(0, 20).map((change) => record(change).path),
	});
	result.truncated ||= changes.length > 20;
	return result;
}

export function chatApprovalDetail(value: unknown): NativeApprovalDetail {
	const item = record(value);
	const source = Array.isArray(item.detail) ? item.detail : [];
	const content = source.slice(0, 20).map(record);
	const commands = content
		.filter(
			(entry) => entry.type === "terminal" && typeof entry.command === "string",
		)
		.map((entry) => approvalDetail({ command: entry.command }));
	const result = approvalDetail({
		reason: item.reason ?? item.title,
		command: commands.map((entry) => entry.command).join("\n"),
		paths: content
			.filter((entry) => entry.type === "diff")
			.map((entry) => entry.path),
	});
	result.truncated ||=
		source.length > 20 || commands.some((entry) => entry.truncated);
	result.redacted ||= commands.some((entry) => entry.redacted);
	return result;
}
