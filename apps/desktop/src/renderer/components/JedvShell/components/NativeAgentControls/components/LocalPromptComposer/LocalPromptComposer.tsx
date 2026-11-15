import { PromptInputProvider } from "@jedv/ui/ai-elements/prompt-input";
import { LocalPromptComposerBody } from "./components/LocalPromptComposerBody/LocalPromptComposerBody";
import type { LocalPromptComposerProps } from "./props";
export function LocalPromptComposer(props: LocalPromptComposerProps) {
	return (
		<PromptInputProvider
			initialInput={props.draft.text}
			attachmentsStore={props.draft.attachments}
		>
			<LocalPromptComposerBody {...props} />
		</PromptInputProvider>
	);
}
