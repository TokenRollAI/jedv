import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { CLIError } from "@jedv/cli-framework";
import {
	MAX_ATTACHMENTS,
	MAX_INLINE_ATTACHMENT_BYTES,
} from "@jedv/shared/attachment-limits";
import mimeTypes from "mime-types";
import type { ResolvedHostTarget } from "./host-target";

interface LocalFile {
	path: string;
	filename: string;
	mediaType: string;
	sizeBytes: number;
}

function readLocalFile(path: string): LocalFile {
	const filename = basename(path);
	const mediaType = mimeTypes.lookup(filename);
	if (!mediaType) {
		throw new CLIError(
			`Could not determine media type for attachment: ${path}`,
			"Use a recognizable file extension (e.g. .png, .pdf, .md)",
		);
	}
	let sizeBytes: number;
	try {
		sizeBytes = statSync(path).size;
	} catch {
		throw new CLIError(`Attachment not found: ${path}`);
	}
	return { path, filename, mediaType, sizeBytes };
}

function megabytes(bytes: number): string {
	return `${Math.ceil(bytes / 1024 / 1024)} MB`;
}

export async function uploadAttachments({
	target,
	paths,
}: {
	target: Pick<ResolvedHostTarget, "kind" | "client">;
	paths: string[];
}): Promise<string[]> {
	if (paths.length > MAX_ATTACHMENTS)
		throw new CLIError(
			`At most ${MAX_ATTACHMENTS} attachments can be sent at once`,
		);
	const files = paths.map(readLocalFile);
	for (const file of files) {
		if (file.sizeBytes > MAX_INLINE_ATTACHMENT_BYTES)
			throw new CLIError(
				`Attachment ${file.filename} exceeds the local ${megabytes(MAX_INLINE_ATTACHMENT_BYTES)} limit`,
			);
	}
	const ids: string[] = [];
	for (const file of files) {
		const result = await target.client.attachments.upload.mutate({
			data: {
				kind: "base64",
				data: readFileSync(file.path).toString("base64"),
			},
			mediaType: file.mediaType,
			originalFilename: file.filename,
		});
		ids.push(result.attachmentId);
	}
	return ids;
}
