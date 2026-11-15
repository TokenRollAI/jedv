import { sanitizePromptForPty } from "@jedv/shared/agent-prompt-launch";
import { createPromptInputAttachmentsStore } from "@jedv/ui/ai-elements/prompt-input";
import { quote } from "shell-quote";
export function prepareLocalPrompt(
	raw: string,
	paths: readonly string[] = [],
): string | null {
	const text = sanitizePromptForPty(raw);
	if (!text.trim() && !paths.length) return null;
	if (!paths.length) return text;
	const escaped = quote([...paths]);
	return text.trim() ? `${text} ${escaped}` : escaped;
}
export function createLocalPromptDraft() {
	return {
		targetKey: null as string | null,
		text: "",
		attachments: createPromptInputAttachmentsStore(),
		paths: new Map<string, string>(),
		copyUnknown: false,
	};
}
export type LocalPromptDraft = ReturnType<typeof createLocalPromptDraft>;
export function discardLocalPromptDraft(
	draft: LocalPromptDraft,
	targetKey: string,
) {
	draft.text = "";
	draft.attachments.clear();
	draft.paths.clear();
	draft.copyUnknown = false;
	draft.targetKey = targetKey;
}
