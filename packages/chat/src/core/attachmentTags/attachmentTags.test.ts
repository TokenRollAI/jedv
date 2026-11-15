import { describe, expect, it } from "bun:test";
import {
	attachmentDisplayName,
	formatAttachmentTag,
	parseAttachmentTags,
} from "./attachmentTags";

function legacyPastedMessage(
	prompt: string,
	pastes: readonly string[],
): string {
	const blocks = pastes.map(
		(paste) =>
			`<pasted_text lines="${paste.split("\n").length}">\n${paste}\n</pasted_text>`,
	);
	return [prompt, ...blocks].filter(Boolean).join("\n\n");
}

describe("attachmentTags", () => {
	it("round-trips tags appended to a message and strips them from the text", () => {
		const message = [
			"look at these",
			formatAttachmentTag({
				path: ".jedv/attachments/shot.png",
				type: "image/png",
			}),
			formatAttachmentTag({
				path: ".jedv/attachments/notes.txt",
				type: 'text/plain" onerror="x',
			}),
		].join("\n");

		expect(parseAttachmentTags(message)).toEqual({
			text: "look at these",
			attachments: [
				{ path: ".jedv/attachments/shot.png", type: "image/png" },
				{ path: ".jedv/attachments/notes.txt", type: "" },
			],
			pastedTexts: [],
		});
	});

	it("reads current and legacy workspace attachment paths", () => {
		const message = [
			'<attachment path=".jedv/attachments/new.png" type="image/png" />',
			'<attachment path=".paradev/attachments/old.png" type="image/png" />',
			'<attachment path=".superset/attachments/old.png" type="image/png" />',
		].join("\n");

		expect(parseAttachmentTags(message).attachments.map((a) => a.path)).toEqual(
			[
				".jedv/attachments/new.png",
				".paradev/attachments/old.png",
				".superset/attachments/old.png",
			],
		);
	});

	it("leaves tags that point outside the workspace attachments folder as plain text", () => {
		const message = [
			'<attachment path=".jedv/attachments/../../../etc/passwd" type="image/png" />',
			'<attachment path="/etc/hosts" type="image/png" />',
			'<attachment path=".jedv/attachments/.." type="image/png" />',
		].join("\n");

		expect(parseAttachmentTags(message)).toEqual({
			text: message,
			attachments: [],
			pastedTexts: [],
		});
	});

	it("takes trailing pasted text off first, so a tag inside a paste stays in it", () => {
		const tag = formatAttachmentTag({
			path: ".jedv/attachments/shot.png",
			type: "image/png",
		});
		const paste = `log line\n${tag}`;
		const message = legacyPastedMessage(`look\n${tag}`, [paste]);

		expect(parseAttachmentTags(message)).toEqual({
			text: "look",
			attachments: [{ path: ".jedv/attachments/shot.png", type: "image/png" }],
			pastedTexts: [paste],
		});
	});

	it("keeps the attached name, escaped, and falls back to the file on disk without one", () => {
		const message = [
			formatAttachmentTag({
				path: ".jedv/attachments/Jedv-arm64__21_.dmg",
				type: "application/x-apple-diskimage",
				name: 'Jedv-arm64 (21) "final" <v2>.dmg',
			}),
			formatAttachmentTag({
				path: ".jedv/attachments/notes.txt",
				type: "text/plain",
				name: "notes.txt",
			}),
		].join("\n");

		expect(message).toContain(
			'name="Jedv-arm64 (21) &quot;final&quot; &lt;v2&gt;.dmg"',
		);
		expect(message).not.toContain('name="notes.txt"');
		const { attachments } = parseAttachmentTags(message);
		expect(attachments.map(attachmentDisplayName)).toEqual([
			'Jedv-arm64 (21) "final" <v2>.dmg',
			"notes.txt",
		]);
	});
});
