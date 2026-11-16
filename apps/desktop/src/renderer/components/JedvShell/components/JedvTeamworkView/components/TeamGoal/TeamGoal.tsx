import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
export function TeamGoal({ name, goal }: { name: string; goal: string }) {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const compact = goal.trim().replace(/\s+/g, " ");
	return (
		<section className="space-y-2 py-3 min-w-0">
			<p className="line-clamp-2 break-words text-sm leading-6">
				{compact.length <= 180 ? compact || name : name}
			</p>
			{compact && compact !== name.trim() && (
				<details className="text-xs text-muted-foreground">
					<summary className="cursor-pointer rounded py-1 focus-visible:ring-2 focus-visible:ring-ring">
						<Trans>Full task instructions</Trans>
					</summary>
					<div className="mt-2 rounded border border-border p-3">
						<Button
							type="button"
							size="sm"
							variant="ghost"
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
							{copied ? (
								<Trans>Copied</Trans>
							) : (
								<Trans>Copy original instructions</Trans>
							)}
						</Button>
						{failed && (
							<p role="alert">
								<Trans>Could not copy. Select the text below to copy it.</Trans>
							</p>
						)}
						<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6 select-text">
							{goal}
						</pre>
					</div>
				</details>
			)}
		</section>
	);
}
