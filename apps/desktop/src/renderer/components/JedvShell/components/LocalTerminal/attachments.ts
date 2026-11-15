import { i18n } from "@jedv/i18n";
import {
	MAX_ATTACHMENTS,
	MAX_INLINE_ATTACHMENT_BYTES,
} from "@jedv/shared/attachment-limits";
import { msg } from "@lingui/core/macro";
import { fileToBase64 } from "renderer/lib/file-to-base64";
import { quote } from "shell-quote";
import type { LocalClient } from "../../local-client";

export const shellEscapePaths = (paths: string[]) => quote(paths);

export async function uploadTerminalAttachments(
	client: LocalClient,
	workspaceId: string,
	files: File[],
) {
	if (!files.length) return [];
	if (
		files.length > MAX_ATTACHMENTS ||
		files.some((file) => file.size > MAX_INLINE_ATTACHMENT_BYTES)
	)
		throw new Error(i18n._(msg({ message: "Attachment limits exceeded" })));
	const attachmentIds: string[] = [];
	for (const file of files) {
		const uploaded = await client.attachments.upload.mutate({
			data: { kind: "base64", data: await fileToBase64(file) },
			mediaType: file.type || "application/octet-stream",
			originalFilename: file.name,
		});
		attachmentIds.push(uploaded.attachmentId);
	}
	return (
		await client.attachments.materializeIntoWorkspace.mutate({
			workspaceId,
			attachmentIds,
		})
	).paths;
}
