export type AttachmentPayload = { filename?: string; url: string };
type Item = { kind: "base64"; name: string; data: string };
type CopyResult =
	| { ok: true; paths: string[] }
	| { ok: false; index: number; problem: string };
export class AttachmentCopyError extends Error {
	constructor(
		readonly reason: "unreadable" | "incomplete" | "source",
		readonly index?: number,
		readonly problem?: string,
	) {
		super(reason);
	}
}
export async function copyPromptAttachments({
	files,
	draft,
	write,
}: {
	files: readonly AttachmentPayload[];
	draft: { paths: Map<string, string>; copyUnknown: boolean };
	write(items: Item[]): Promise<CopyResult>;
}) {
	const keys = await Promise.all(
		files.map(async (file) => {
			const digest = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(file.url),
			);
			return `${file.filename ?? "attachment"}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		}),
	);
	const missing = files
		.map((file, index) => ({ file, index }))
		.filter(({ index }) => !draft.paths.has(keys[index]));
	if (missing.length) {
		const items = missing.map(({ file }) => {
			const comma = file.url.indexOf(",");
			if (
				!file.url.startsWith("data:") ||
				comma < 0 ||
				!file.url.slice(0, comma).endsWith(";base64")
			)
				throw new AttachmentCopyError("unreadable");
			return {
				kind: "base64" as const,
				name: file.filename ?? "attachment",
				data: file.url.slice(comma + 1),
			};
		});
		let result: CopyResult;
		try {
			result = await write(items);
		} catch (cause) {
			draft.copyUnknown = true;
			throw cause;
		}
		if (!result.ok)
			throw new AttachmentCopyError("source", result.index, result.problem);
		if (result.paths.length !== missing.length) {
			draft.copyUnknown = true;
			throw new AttachmentCopyError("incomplete");
		}
		missing.forEach(({ index }, offset) => {
			draft.paths.set(keys[index], result.paths[offset]);
		});
	}
	return keys.map((key) => draft.paths.get(key) ?? "");
}
