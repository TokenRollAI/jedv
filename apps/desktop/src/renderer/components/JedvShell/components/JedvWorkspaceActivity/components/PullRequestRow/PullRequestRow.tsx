import { useLingui } from "@lingui/react/macro";
import type { MouseEvent, ReactNode } from "react";
import { PullRequestStateIcon } from "../../../JedvPullRequestsView/components/PullRequestStateIcon";
export type PullRequestEntry = {
	repoOwner: string;
	repoName: string;
	number: number;
	url: string;
	title: string;
	state: string;
	isDraft: boolean;
	headBranch: string;
	checksStatus: "success" | "failure" | "pending" | "none";
};

export function PullRequestRow({
	pullRequest,
	menu,
	onOpen,
}: {
	pullRequest: PullRequestEntry;
	menu?: ReactNode;
	onOpen: (pullRequest: PullRequestEntry, event: MouseEvent) => void;
}) {
	const state = pullRequest.state;
	const { t } = useLingui();
	const checks = {
		success: t({ message: "Passed" }),
		failure: t({ message: "Failed" }),
		pending: t({ message: "Running" }),
		none: "",
	};
	return (
		<div className="flex min-h-7 items-center gap-1 rounded-sm pr-1 transition-colors hover:bg-accent">
			<button
				type="button"
				onClick={(event) => onOpen(pullRequest, event)}
				className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-sm py-0.5 pr-1 pl-2 text-left text-xs outline-none focus-visible:bg-accent"
			>
				<PullRequestStateIcon state={state} draft={pullRequest.isDraft} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="shrink-0 text-muted-foreground tabular-nums">
							#{pullRequest.number}
						</span>

						<span className="min-w-0 truncate text-foreground">
							{pullRequest.title}
						</span>
					</span>
					<span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
						{pullRequest.repoOwner}/{pullRequest.repoName} ·{" "}
						{pullRequest.headBranch}
					</span>
				</span>
				{pullRequest.checksStatus !== "none" && (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{checks[pullRequest.checksStatus]}
					</span>
				)}
			</button>
			{menu}
		</div>
	);
}
