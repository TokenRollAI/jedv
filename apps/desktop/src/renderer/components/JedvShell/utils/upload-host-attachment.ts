import { MAX_INLINE_ATTACHMENT_BYTES } from "@jedv/shared/attachment-limits";
import type { LocalClient } from "../local-client";

export class AttachmentReadError extends Error {
	readonly reason: "too-large" | "empty" | "unreadable";

	constructor(reason: "too-large" | "empty" | "unreadable", message: string) {
		super(message);
		this.name = "AttachmentReadError";
		this.reason = reason;
	}
}

export function createSafePreviewUrl(file: File): string | null {
	if (!file.type.startsWith("image/")) return null;
	try {
		return URL.createObjectURL(file);
	} catch {
		return null;
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		const chunk = bytes.subarray(offset, offset + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

export async function fileToBase64(file: Blob): Promise<string> {
	if (file.size > MAX_INLINE_ATTACHMENT_BYTES) {
		throw new AttachmentReadError(
			"too-large",
			`Attachment exceeds ${Math.round(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`,
		);
	}
	if (file.size === 0) {
		throw new AttachmentReadError("empty", "Attachment is empty");
	}
	try {
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		if (bytes.length === 0) {
			throw new AttachmentReadError("empty", "Attachment is empty");
		}
		return bytesToBase64(bytes);
	} catch (error) {
		if (error instanceof AttachmentReadError) throw error;
		throw new AttachmentReadError(
			"unreadable",
			"The attachment could not be read.",
		);
	}
}

export function dataUrlToBase64(url: string): {
	base64: string;
	mediaType: string;
} | null {
	if (!url.startsWith("data:")) return null;
	const commaIndex = url.indexOf(",");
	if (commaIndex < 0) return null;
	const header = url.slice(5, commaIndex);
	const semiIndex = header.indexOf(";");
	const mediaType =
		(semiIndex >= 0 ? header.slice(0, semiIndex) : header) ||
		"application/octet-stream";
	const base64 = url.slice(commaIndex + 1);
	return base64 ? { base64, mediaType } : null;
}

export async function uploadHostAttachment(
	client: LocalClient,
	file: File,
): Promise<{
	attachmentId: string;
	originalFilename?: string;
	mediaType: string;
	sizeBytes: number;
}> {
	const base64 = await fileToBase64(file);
	return client.attachments.upload.mutate({
		data: { kind: "base64", data: base64 },
		mediaType: file.type || "application/octet-stream",
		originalFilename: file.name || undefined,
	});
}
