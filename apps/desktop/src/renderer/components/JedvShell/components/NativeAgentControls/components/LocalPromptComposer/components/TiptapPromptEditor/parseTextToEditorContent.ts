import type { JSONContent } from "@tiptap/core";

const MENTION_RE = /(?:^|(?<=\s))@(?:"([^"]+)"|(\S+))/g;

export function parseTextToEditorContent(text: string): JSONContent {
	const paragraphs = text.split("\n").map((line): JSONContent => {
		if (line === "") {
			return { type: "paragraph" };
		}

		const inlineNodes: JSONContent[] = [];
		let lastIndex = 0;
		MENTION_RE.lastIndex = 0;

		let match: RegExpExecArray | null = MENTION_RE.exec(line);
		while (match !== null) {
			if (match.index > lastIndex) {
				inlineNodes.push({
					type: "text",
					text: line.slice(lastIndex, match.index),
				});
			}
			const quotedPath = match[1];
			const token = quotedPath ?? match[2] ?? "";
			inlineNodes.push({
				type: "file-mention",
				attrs: { path: token, fromText: quotedPath === undefined },
			});

			lastIndex = match.index + match[0].length;
			match = MENTION_RE.exec(line);
		}
		if (lastIndex < line.length) {
			inlineNodes.push({ type: "text", text: line.slice(lastIndex) });
		}

		return { type: "paragraph", content: inlineNodes };
	});

	return { type: "doc", content: paragraphs };
}
