import type { ButlerMessageShape, ButlerSendResult } from "@jedv/shared/butler";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuArrowUp, LuSettings2 } from "react-icons/lu";
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
		[reason, setReason] = useState<ButlerSendResult["reason"]>(null);
	const request = useRef<{ body: string; id: string } | null>(null),
		busy = useRef(false);
	const send = async () => {
		if (busy.current || disabled || !draft.trim()) return;
		busy.current = true;
		setPending(true);
		setFailed(false);
		if (!request.current || request.current.body !== draft)
			request.current = { body: draft, id: crypto.randomUUID() };
		try {
			const result = await onSend(draft, request.current.id);
			setDraft("");
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
				className="mx-2 mb-2 flex shrink-0 items-end gap-1 rounded-md border border-border p-1"
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				<textarea
					aria-label={t({ message: "Ask Butler…" })}
					placeholder={t({ message: "Ask Butler…" })}
					rows={2}
					maxLength={12000}
					disabled={disabled || pending}
					value={draft}
					onChange={(event) => {
						setDraft(event.target.value);
						onDraftChange?.(!!event.target.value);
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
					label={pending ? t({ message: "Sending…" }) : t({ message: "Send" })}
					type="submit"
					className="size-6"
					disabled={disabled || pending || !draft.trim()}
				>
					<LuArrowUp className="size-3.5" />
				</JedvIconButton>
			</form>
		</div>
	);
}
