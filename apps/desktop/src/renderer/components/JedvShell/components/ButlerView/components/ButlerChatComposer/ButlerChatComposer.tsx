import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@jedv/ui/ai-elements/prompt-input";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuArrowUp, LuRefreshCw, LuSettings2 } from "react-icons/lu";
import { JedvIconButton } from "../../../JedvIconButton";
import type { ConversationDraft } from "../../hooks/useButlerConversation";
export function ButlerChatComposer({
	draft,
	disabled,
	noKey,
	onChange,
	onSend,
	onSettings,
}: {
	draft: ConversationDraft;
	disabled: boolean;
	noKey: boolean;
	onChange(text: string): void;
	onSend(): Promise<void>;
	onSettings(): void;
}) {
	const { t } = useLingui();
	const label = draft.pending
		? t({ message: "Sending…" })
		: draft.failed
			? t({ message: "Retry" })
			: t({ message: "Send" });
	return (
		<div className="mx-auto w-full max-w-[792px] shrink-0 space-y-2 px-4 pb-4 pt-2">
			{(noKey || draft.reason) && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<p className="flex-1">
						{noKey || draft.reason === "no_key"
							? t({
									message:
										"DeepSeek is not configured. Status and Inbox still work.",
								})
							: t({
									message:
										"Butler is unavailable. Status and Inbox still work.",
								})}
					</p>
					<JedvIconButton
						label={t({ message: "Settings" })}
						onClick={onSettings}
					>
						<LuSettings2 className="size-4" />
					</JedvIconButton>
				</div>
			)}
			{draft.failed && (
				<p role="alert" className="text-xs text-destructive">
					<Trans>
						The result is uncertain. Retry this message with the same request
						ID.
					</Trans>
				</p>
			)}
			<PromptInput
				maxFiles={0}
				onSubmit={onSend}
				onSubmitCapture={(e) => {
					if (disabled || draft.pending || !draft.text.trim()) {
						e.preventDefault();
						e.stopPropagation();
					}
				}}
			>
				<PromptInputBody>
					<PromptInputTextarea
						aria-label={t({ message: "Ask Butler…" })}
						placeholder={t({ message: "Ask Butler…" })}
						value={draft.text}
						onChange={(e) => onChange(e.currentTarget.value)}
						disabled={disabled || draft.pending}
						readOnly={!!draft.request}
						maxLength={12000}
						className="min-h-12 resize-none px-3 py-2 text-sm"
					/>
				</PromptInputBody>
				<PromptInputFooter className="justify-end p-2">
					<PromptInputSubmit
						aria-label={label}
						title={label}
						disabled={disabled || draft.pending || !draft.text.trim()}
						className="size-7"
					>
						{draft.failed ? (
							<LuRefreshCw className="size-4" />
						) : (
							<LuArrowUp className="size-4" />
						)}
					</PromptInputSubmit>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
