import { MAX_ATTACHMENTS } from "@jedv/shared/attachment-limits";
import type { ButlerMessageShape, ButlerSendResult } from "@jedv/shared/butler";
import { getClipboardFiles } from "@jedv/ui/lib/clipboard-files";
import { Trans, useLingui } from "@lingui/react/macro";
import { Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LuArrowUp, LuSettings2 } from "react-icons/lu";
import { createSafePreviewUrl } from "../../../../utils/upload-host-attachment";
import { JedvIconButton } from "../../../JedvIconButton";
export function ButlerConversation({
	messages,
	disabled,
	loading,
	noKey,
	onSend,
	onSettings,
	resultReason = null,
	onDraftChange,
}: {
	messages: ButlerMessageShape[];
	disabled: boolean;
	loading: boolean;
	noKey: boolean;
	onSend(humanText: string, requestId: string): Promise<ButlerSendResult>;
	onSettings(): void;
	resultReason?: ButlerSendResult["reason"];
	onDraftChange?(dirty: boolean): void;
}) {
	const { t } = useLingui();
	const [draft, setDraft] = useState(""),
		[pending, setPending] = useState(false),
		[failed, setFailed] = useState(false),
		[reason, setReason] = useState<ButlerSendResult["reason"]>(null),
		[attachments, setAttachments] = useState<
			Array<{ id: string; file: File; previewUrl: string | null }>
		>([]);
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	useEffect(
		() => () => {
			for (const item of attachmentsRef.current) {
				if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
			}
		},
		[],
	);
	const request = useRef<{ body: string; id: string } | null>(null),
		busy = useRef(false);
	const hasContent = !!draft.trim() || attachments.length > 0;
	const send = async () => {
		if (busy.current || disabled || !hasContent) return;
		busy.current = true;
		setPending(true);
		setFailed(false);
		const notes = attachments.map(
			(item) => `[Attachment: ${item.file.name || "image"}]`,
		);
		const payload =
			notes.length > 0
				? [draft, ...notes]
						.filter((part) => part.length > 0)
						.join("\n")
						.slice(0, 12_000)
				: draft;
		if (!request.current || request.current.body !== payload)
			request.current = { body: payload, id: crypto.randomUUID() };
		try {
			const result = await onSend(payload, request.current.id);
			setDraft("");
			for (const item of attachmentsRef.current) {
				if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
			}
			setAttachments([]);
			onDraftChange?.(false);
			request.current = null;
			setReason(result.reason);
		} catch {
			setFailed(true);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2.5 py-2"
				aria-live="polite"
			>
				{loading && (
					<output className="block text-[11px] text-muted-foreground">
						<Trans>Loading…</Trans>
					</output>
				)}
				{!loading &&
					messages.filter((message) => message.role !== "tool").length ===
						0 && (
						<p className="text-[11px] text-muted-foreground">
							<Trans>Ask Butler about your teams, alerts or automations.</Trans>
						</p>
					)}
				{messages
					.filter((message) => message.role !== "tool")
					.map((message) => (
						<div
							key={message.id}
							className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${message.role === "human" ? "text-foreground" : "text-muted-foreground"}`}
						>
							<span className="sr-only">
								{message.role === "human"
									? t({ message: "You" })
									: t({ message: "Butler" })}
								:{" "}
							</span>
							{message.content}
						</div>
					))}
			</div>
			{(noKey || reason || resultReason) && (
				<div className="flex shrink-0 items-center gap-1 px-2.5 pb-2 text-[10px] text-muted-foreground">
					<span className="flex-1">
						{noKey || reason === "no_key" || resultReason === "no_key"
							? t({
									message:
										"DeepSeek is not configured. Status and Inbox still work.",
								})
							: t({
									message:
										"Butler is unavailable. Status and Inbox still work.",
								})}
					</span>
					<JedvIconButton
						label={t({ message: "Settings" })}
						className="size-6"
						onClick={onSettings}
					>
						<LuSettings2 className="size-3.5" />
					</JedvIconButton>
				</div>
			)}
			{failed && (
				<p
					role="alert"
					className="shrink-0 px-2.5 pb-2 text-[11px] text-destructive"
				>
					<Trans>
						The result is uncertain. Retry this message with the same request
						ID.
					</Trans>
				</p>
			)}
			<form
				className="mx-2 mb-2 flex shrink-0 flex-col gap-1.5 rounded-md border border-border p-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				{attachments.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						{attachments.map((item) => (
							<div
								key={item.id}
								className="flex items-center gap-1 rounded border border-border/70 bg-secondary/45 p-0.5 pr-1.5 text-[11px]"
							>
								{item.previewUrl ? (
									<img
										src={item.previewUrl}
										alt={item.file.name}
										className="size-7 rounded object-cover"
									/>
								) : (
									<Paperclip className="ml-1 size-3 text-muted-foreground" />
								)}
								<span className="max-w-24 truncate text-muted-foreground">
									{item.file.name}
								</span>
								<button
									type="button"
									aria-label={t({ message: "Remove attachment" })}
									onClick={() => {
										setAttachments((prev) => {
											const found = prev.find((x) => x.id === item.id);
											if (found?.previewUrl)
												URL.revokeObjectURL(found.previewUrl);
											const next = prev.filter((x) => x.id !== item.id);
											onDraftChange?.(!!draft || next.length > 0);
											return next;
										});
									}}
									className="text-muted-foreground hover:text-foreground"
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
				)}
				<div className="flex items-end gap-1">
					<textarea
						aria-label={t({ message: "Ask Butler…" })}
						placeholder={t({ message: "Ask Butler…" })}
						rows={2}
						maxLength={12000}
						disabled={pending}
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							onDraftChange?.(!!event.target.value || attachments.length > 0);
						}}
						onPaste={(event) => {
							if (pending) return;
							const files = getClipboardFiles(event.clipboardData);
							if (files.length > 0) {
								event.preventDefault();
								setAttachments((prev) => {
									const remaining = MAX_ATTACHMENTS - prev.length;
									if (remaining <= 0) return prev;
									const added = files.slice(0, remaining).map((file) => ({
										id: crypto.randomUUID(),
										file,
										previewUrl: createSafePreviewUrl(file),
									}));
									const next = [...prev, ...added];
									onDraftChange?.(!!draft || next.length > 0);
									return next;
								});
							}
						}}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								(event.metaKey || event.ctrlKey) &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								void send();
							}
						}}
						className="min-w-0 flex-1 resize-none bg-transparent p-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
					/>
					<JedvIconButton
						label={
							pending ? t({ message: "Sending…" }) : t({ message: "Send" })
						}
						type="submit"
						className="size-6"
						disabled={disabled || pending || !hasContent}
					>
						<LuArrowUp className="size-3.5" />
					</JedvIconButton>
				</div>
			</form>
		</div>
	);
}
