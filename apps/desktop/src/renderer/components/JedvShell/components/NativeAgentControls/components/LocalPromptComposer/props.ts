import type { LocalClient } from "../../../../local-client";
import type { LocalPromptDraft } from "./utils/prompt";
export interface LocalPromptComposerProps {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	targetKey: string;
	draft: LocalPromptDraft;
	remote: boolean;
	disabled: boolean;
	submitLabel: string;
	onSubmitText(text: string): Promise<void>;
}
