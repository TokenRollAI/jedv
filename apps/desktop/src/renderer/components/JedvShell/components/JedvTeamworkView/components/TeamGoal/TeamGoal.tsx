import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronRight, LuCopy } from "react-icons/lu";

const GOAL_PREVIEW_MAX_CHARS = 120;

export function truncateGoalPreview(
	goal: string,
	maxChars = GOAL_PREVIEW_MAX_CHARS,
): string {
	const compact = goal.trim().replace(/\s+/g, " ");
	const chars = Array.from(compact);
	if (chars.length <= maxChars) return compact;
	const slice = chars.slice(0, Math.max(1, maxChars - 1)).join("");
	const match = slice.match(/^(.*?)[\s,;:、，；：]+[^\s,;:、，；：]*$/u);
	const cut =
		match?.[1] && match[1].length >= Math.floor(slice.length * 0.4)
			? match[1]
			: slice;
	return `${cut.replace(/[\s,;:、，；：]+$/u, "")}…`;
}

export function TeamGoal({ name, goal }: { name: string; goal: string }) {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const compact = goal.trim().replace(/\s+/g, " ");
	if (!compact || compact === name.trim()) return null;
	const preview = truncateGoalPreview(compact);
	return (
		<section className="min-w-0 space-y-2 pt-3 pb-1.5">
			<p
				className="truncate text-[13px] leading-relaxed text-foreground/90"
				title={compact}
			>
				{preview}
			</p>
			<details className="group text-xs text-muted-foreground">
				<summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border/60 bg-card/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
					<LuChevronRight
						className="size-3 shrink-0 transition-transform group-open:rotate-90"
						aria-hidden="true"
					/>
					<Trans>Full task instructions</Trans>
				</summary>
				<div className="mt-2 rounded-xl border border-border/70 bg-card/50 p-3">
					<div className="flex items-center justify-end">
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
							onClick={async () => {
								setFailed(false);
								try {
									await navigator.clipboard.writeText(goal);
									setCopied(true);
								} catch {
									setFailed(true);
								}
							}}
						>
							<LuCopy className="size-3" />
							{copied ? (
								<Trans>Copied</Trans>
							) : (
								<Trans>Copy original instructions</Trans>
							)}
						</Button>
					</div>
					{failed && (
						<p role="alert" className="mt-1 text-destructive">
							<Trans>Could not copy. Select the text below to copy it.</Trans>
						</p>
					)}
					<pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6 text-foreground/85 select-text">
						{goal}
					</pre>
				</div>
			</details>
		</section>
	);
}
