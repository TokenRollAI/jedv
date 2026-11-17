import {
	MAX_ATTACHMENTS,
	MAX_INLINE_ATTACHMENT_BYTES,
} from "@jedv/shared/attachment-limits";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputBody,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	usePromptInputAttachments,
} from "@jedv/ui/ai-elements/prompt-input";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { Paperclip } from "lucide-react";
import { useState } from "react";
import { LuArrowUp, LuRefreshCw, LuSettings2 } from "react-icons/lu";
import type { LocalClient } from "../../../../local-client";
import { dataUrlToBase64 } from "../../../../utils/upload-host-attachment";
import type { ConversationDraft } from "../../hooks/useButlerConversation";

function ButlerComposerFooter({
	disabled,
	submitDisabled,
	failed,
	label,
}: {
	disabled: boolean;
	submitDisabled: boolean;
	failed: boolean;
	label: string;
}) {
	const { t } = useLingui();
	const attachments = usePromptInputAttachments();
	return (
		<PromptInputFooter className="justify-between px-2.5 pb-2.5 pt-1">
			<div className="flex items-center gap-1">
				<PromptInputActionMenu>
					<PromptInputActionMenuTrigger
						disabled={disabled || attachments.files.length >= MAX_ATTACHMENTS}
						aria-label={t({ message: "Attach files" })}
						title={t({ message: "Attach files" })}
					>
						<Paperclip className="size-3.5" />
					</PromptInputActionMenuTrigger>
					<PromptInputActionMenuContent>
						<PromptInputActionAddAttachments />
					</PromptInputActionMenuContent>
				</PromptInputActionMenu>
			</div>
			<PromptInputSubmit
				aria-label={label}
				title={label}
				disabled={submitDisabled}
				className="size-8 rounded-lg"
			>
				{failed ? (
					<LuRefreshCw className="size-4" />
				) : (
					<LuArrowUp className="size-4" />
				)}
			</PromptInputSubmit>
		</PromptInputFooter>
	);
}

function ButlerSubmitGate({
	disabled,
	missingKey,
	hasText,
	failed,
	label,
}: {
	disabled: boolean;
	missingKey: boolean;
	hasText: boolean;
	failed: boolean;
	label: string;
}) {
	const attachments = usePromptInputAttachments();
	const hasContent = hasText || attachments.files.length > 0;
	return (
		<ButlerComposerFooter
			disabled={disabled}
			submitDisabled={disabled || missingKey || !hasContent}
			failed={failed}
			label={label}
		/>
	);
}

export function ButlerChatComposer({
	client,
	draft,
	disabled,
	noKey,
	onChange,
	onSend,
	onSettings,
	onOpenSettings,
}: {
	client?: LocalClient;
	draft: ConversationDraft;
	disabled: boolean;
	noKey: boolean;
	onChange(text: string): void;
	onSend(textOverride?: string): Promise<void>;
	onSettings?: () => void;
	onOpenSettings?: () => void;
}) {
	const { t } = useLingui();
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const missingKey = noKey || draft.reason === "no_key";
	const openSettings = onOpenSettings ?? onSettings;
	const editorDisabled = disabled || draft.pending;
	const label = draft.pending
		? t({ message: "Sending…" })
		: draft.failed
			? t({ message: "Retry" })
			: t({ message: "Send" });
	const handleSubmit = async (message: PromptInputMessage) => {
		setAttachmentError(null);
		if (editorDisabled || missingKey) return;
		if (draft.request || message.files.length === 0) {
			if (!draft.text.trim() && !draft.request) return;
			await onSend();
			return;
		}
		const baseText = draft.text || message.text;
		const attachmentNotes: string[] = [];
		if (message.files.length > 0 && client) {
			const uploadedIds: string[] = [];
			for (const file of message.files) {
				const parsed = file.url ? dataUrlToBase64(file.url) : null;
				if (!parsed) continue;
				const uploaded = await client.attachments.upload.mutate({
					data: { kind: "base64", data: parsed.base64 },
					mediaType: file.mediaType || parsed.mediaType,
					originalFilename: file.filename || undefined,
				});
				uploadedIds.push(uploaded.attachmentId);
				attachmentNotes.push(
					`[Attachment: ${file.filename || uploaded.attachmentId} (attachmentId: ${uploaded.attachmentId})]`,
				);
			}
			if (uploadedIds.length > 0 && draft.context?.workspaceId) {
				try {
					const materialized =
						await client.attachments.materializeIntoWorkspace.mutate({
							workspaceId: draft.context.workspaceId,
							attachmentIds: uploadedIds,
						});
					if (materialized.paths.length > 0) {
						attachmentNotes.push(
							`[Workspace files: ${materialized.paths.join(", ")}]`,
						);
					}
				} catch {
					/* Attachment metadata note still carries the uploaded IDs. */
				}
			}
		} else if (message.files.length > 0) {
			for (const file of message.files) {
				attachmentNotes.push(`[Attachment: ${file.filename || "image"}]`);
			}
		}
		const combined = [baseText, ...attachmentNotes]
			.filter(Boolean)
			.join("\n")
			.slice(0, 12_000);
		if (!combined.trim()) return;
		await onSend(combined);
	};
	return (
		<div className="mx-auto w-full max-w-[792px] shrink-0 space-y-2 px-4 pb-4 pt-2">
			{(noKey || draft.reason) && (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
					<p className="min-w-0 flex-1">
						{missingKey
							? t({
									message:
										"DeepSeek is not configured. Status and Inbox still work.",
								})
							: t({
									message:
										"Butler is unavailable. Status and Inbox still work.",
								})}
					</p>
					{openSettings ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7.5 shrink-0 gap-1.5 rounded-lg px-3 text-xs"
							onClick={openSettings}
						>
							<LuSettings2 className="size-3.5" />
							<Trans>Settings</Trans>
							<span aria-hidden="true">→</span>
							<Trans>System agents</Trans>
						</Button>
					) : (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							<Trans>Settings</Trans> → <Trans>System agents</Trans>
						</span>
					)}
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
			{attachmentError && (
				<p role="alert" className="text-xs text-destructive">
					{attachmentError}
				</p>
			)}
			<PromptInput
				multiple
				maxFiles={MAX_ATTACHMENTS}
				maxFileSize={MAX_INLINE_ATTACHMENT_BYTES}
				onError={(err) => setAttachmentError(err.message)}
				onSubmit={handleSubmit}
				onSubmitCapture={(e) => {
					if (editorDisabled || missingKey) {
						e.preventDefault();
						e.stopPropagation();
					}
				}}
				className="rounded-xl border border-border/80 bg-card/90 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-1 focus-within:ring-ring [&>[data-slot=input-group]]:h-auto [&>[data-slot=input-group]]:flex-col [&>[data-slot=input-group]]:items-stretch [&>[data-slot=input-group]]:rounded-xl [&>[data-slot=input-group]]:border-0 [&>[data-slot=input-group]]:bg-transparent [&>[data-slot=input-group]]:shadow-none"
			>
				<PromptInputAttachments>
					{(file) => <PromptInputAttachment data={file} />}
				</PromptInputAttachments>
				<PromptInputBody>
					<PromptInputTextarea
						aria-label={t({ message: "Ask Butler…" })}
						placeholder={t({ message: "Ask Butler…" })}
						value={draft.text}
						onChange={(e) => onChange(e.currentTarget.value)}
						disabled={editorDisabled}
						readOnly={!!draft.request}
						maxLength={12000}
						className="min-h-12 resize-none px-3 py-2 text-sm"
					/>
				</PromptInputBody>
				<ButlerSubmitGate
					disabled={editorDisabled}
					missingKey={missingKey}
					hasText={!!draft.text.trim()}
					failed={draft.failed}
					label={label}
				/>
			</PromptInput>
		</div>
	);
}
