import { expect, test } from "bun:test";
import { MAX_INLINE_ATTACHMENT_BYTES } from "@jedv/shared/attachment-limits";
import type { LocalClient } from "../../local-client";
import { shellEscapePaths, uploadTerminalAttachments } from "./attachments";

test("terminal file paths keep shell metacharacters literal and oversized remote input never reaches the client", async () => {
	expect(shellEscapePaths(["a b", "$(touch marker)", "a'b"])).toBe(
		"'a b' '$(touch marker)' \"a'b\"",
	);
	let calls = 0;
	const client = {
		attachments: {
			upload: {
				mutate: () => {
					calls++;
				},
			},
		},
	} as unknown as LocalClient;
	await expect(
		uploadTerminalAttachments(client, "workspace", [
			{ size: MAX_INLINE_ATTACHMENT_BYTES + 1 },
		] as File[]),
	).rejects.toThrow();
	expect(calls).toBe(0);
});
