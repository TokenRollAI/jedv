import { cn } from "@jedv/ui/utils";
import {
	LuGitMerge,
	LuGitPullRequest,
	LuGitPullRequestClosed,
	LuGitPullRequestDraft,
} from "react-icons/lu";
export function PullRequestStateIcon({
	state,
	draft = false,
	className,
}: {
	state: string;
	draft?: boolean;
	className?: string;
}) {
	const merged = state.toLowerCase() === "merged";
	const closed = state.toLowerCase() === "closed";
	const Icon = merged
		? LuGitMerge
		: closed
			? LuGitPullRequestClosed
			: draft
				? LuGitPullRequestDraft
				: LuGitPullRequest;
	return (
		<Icon
			className={cn(
				"size-3.5 shrink-0",
				merged
					? "text-purple-500"
					: closed
						? "text-red-500"
						: draft
							? "text-muted-foreground"
							: "text-emerald-500",
				className,
			)}
		/>
	);
}
