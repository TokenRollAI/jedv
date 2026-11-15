import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { VscLoading } from "react-icons/vsc";
export function CommitForm({
	message,
	onMessageChange,
	onCommit,
	busy,
	disabled,
	branch,
	stagedCount,
}: {
	message: string;
	onMessageChange(value: string): void;
	onCommit(): void;
	busy: boolean;
	disabled: boolean;
	branch: string;
	stagedCount: number;
}) {
	const { t } = useLingui();
	return (
		<div className="flex flex-col gap-2 border-b p-2">
			<div className="truncate text-xs text-muted-foreground" title={branch}>
				{branch} · <Trans>{stagedCount} staged files</Trans>
			</div>
			<Textarea
				value={message}
				onChange={(event) => onMessageChange(event.target.value)}
				placeholder={t({ message: "Commit message" })}
				aria-label={t({ message: "Commit message" })}
				className="min-h-20 text-xs"
				disabled={busy}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						if (!disabled && !busy && message.trim()) onCommit();
					}
				}}
			/>
			<button
				type="button"
				onClick={onCommit}
				disabled={disabled || busy || !message.trim()}
				className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{busy && <VscLoading className="size-3.5 animate-spin" />}
				<Trans>Commit staged changes</Trans>
				<kbd className="ml-auto text-[10px] opacity-60">⌘/Ctrl ↵</kbd>
			</button>
		</div>
	);
}
