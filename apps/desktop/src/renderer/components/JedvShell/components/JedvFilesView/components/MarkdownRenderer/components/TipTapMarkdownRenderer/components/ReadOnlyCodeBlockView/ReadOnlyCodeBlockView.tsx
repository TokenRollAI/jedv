import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";

import { CodeBlock } from "../../../index";

export function ReadOnlyCodeBlockView({ node }: NodeViewProps) {
	const language =
		typeof node.attrs.language === "string" ? node.attrs.language : undefined;

	return (
		<NodeViewWrapper as="div" className="my-4">
			{language?.toLowerCase() === "html" && (
				<div className="flex justify-end"></div>
			)}
			<CodeBlock className={`language-${language || "text"}`}>
				{node.textContent}
			</CodeBlock>
		</NodeViewWrapper>
	);
}
