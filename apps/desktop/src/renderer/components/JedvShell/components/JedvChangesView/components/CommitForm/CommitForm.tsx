import { Kbd } from "@jedv/ui/kbd";
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
	showBranchSummary = false,
}: {
	message: string;
	onMessageChange(value: string): void;
	onCommit(): void;
	busy: boolean;
	disabled: boolean;
	branch: string;
	stagedCount: number;
	showBranchSummary?: boolean;
}) {
	const { t } = useLingui();
	return (
		<div className="flex flex-col gap-2 border-b border-border/70 p-2.5">
			{showBranchSummary ? (
				<div className="truncate text-xs text-muted-foreground" title={branch}>
					{branch} · <Trans>{stagedCount} staged files</Trans>
				</div>
			) : (
				stagedCount > 0 && (
					<div className="truncate text-[11px] font-medium text-muted-foreground">
						<Trans>{stagedCount} staged files</Trans>
					</div>
				)
			)}
			<Textarea
				value={message}
				onChange={(event) => onMessageChange(event.target.value)}
				placeholder={t({ message: "Commit message" })}
				aria-label={t({ message: "Commit message" })}
				className="min-h-[72px] resize-none rounded-lg border-border/70 bg-card/40 px-2.5 py-2 text-xs shadow-none"
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
				className="flex h-8 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-2xs transition-colors hover:opacity-90 disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-65"
			>
				{busy && <VscLoading className="size-3.5 animate-spin" />}
				<span className="truncate">
					<Trans>Commit staged changes</Trans>
				</span>
				<Kbd className="ml-auto h-4 border-current/15 bg-transparent px-1.5 text-[10px] text-current/70">
					⌘/Ctrl ↵
				</Kbd>
			</button>
		</div>
	);
}
