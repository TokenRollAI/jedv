import { Button } from "@jedv/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LuGitPullRequest } from "react-icons/lu";
import type { ProjectActionContext } from "../../../JedvProjectActions";
export function PullRequestPicker({
	context,
	projectId,
	value,
	disabled,
	onSelect,
}: {
	context: ProjectActionContext;
	projectId: string;
	value: number | null;
	disabled: boolean;
	onSelect(number: number): void;
}) {
	const { t } = useLingui();
	const [search, setSearch] = useState("");
	const query = useInfiniteQuery({
		queryKey: [
			"jedv",
			context.hostUrl,
			"workspace-create-pr",
			projectId,
			search,
		],
		queryFn: ({ pageParam }) =>
			context.client.workspaceCreation.searchPullRequests.query({
				projectId,
				query: search,
				limit: 30,
				page: pageParam,
				deferChecks: true,
			}),
		initialPageParam: 1,
		getNextPageParam: (last) => (last.hasNextPage ? last.page + 1 : undefined),
		retry: false,
		enabled: !!projectId,
	});
	return (
		<div className="rounded border">
			<Command shouldFilter={false}>
				<CommandInput
					value={search}
					onValueChange={setSearch}
					placeholder={t({
						message: "Search pull requests or enter a PR number…",
					})}
					disabled={disabled}
				/>
				<CommandList className="max-h-48">
					<CommandEmpty>
						{query.isPending ? (
							<Trans>Loading pull requests…</Trans>
						) : query.isError ? (
							<Trans>
								Could not load pull requests. Check gh access on the target
								host.
							</Trans>
						) : (
							<Trans>No pull requests found</Trans>
						)}
					</CommandEmpty>
					{query.data?.pages
						.flatMap((page) => page.pullRequests)
						.map((pr) => (
							<CommandItem
								key={`${pr.projectId}:${pr.prNumber}`}
								value={String(pr.prNumber)}
								disabled={disabled}
								onSelect={() => onSelect(pr.prNumber)}
							>
								<LuGitPullRequest className="size-4 shrink-0" />
								<span className="min-w-0 flex-1 truncate">
									#{pr.prNumber} {pr.title}
								</span>
								{value === pr.prNumber && (
									<span>
										<Trans>Selected</Trans>
									</span>
								)}
							</CommandItem>
						))}
				</CommandList>
			</Command>
			{query.isError && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => void query.refetch()}
				>
					<Trans>Retry</Trans>
				</Button>
			)}
			{query.hasNextPage && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
				>
					<Trans>Load more</Trans>
				</Button>
			)}
		</div>
	);
}
