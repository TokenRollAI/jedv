import { readFile } from "node:fs/promises";
import type { ResolveAttachment } from "@jedv/chat-runtime";
import {
	handOutAttachment,
	handOutAttachmentByFileId,
} from "../trpc/router/attachments/storage";

export function createAttachmentResolver({
	report,
}: {
	report: (error: unknown) => void;
}): ResolveAttachment {
	return async (part) => {
		try {
			const found = part.fileId
				? handOutAttachmentByFileId(part.fileId)
				: part.attachmentId
					? handOutAttachment(part.attachmentId)
					: null;
			if (!found) return null;
			const mimeType = found.metadata.mediaType;
			return {
				path: found.path,
				mimeType,
				data: mimeType.startsWith("image/")
					? (await readFile(found.path)).toString("base64")
					: "",
			};
		} catch (error) {
			report(error);
			return null;
		}
	};
}
