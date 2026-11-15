import { errorMessage } from "@jedv/i18n/errors";
import { formatCompactRelativeTime, formatDateTime } from "@jedv/i18n/format";
import { MessageResponse } from "@jedv/ui/ai-elements/message";
import { Button } from "@jedv/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Textarea } from "@jedv/ui/textarea";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	LuArrowUpRight,
	LuCheck,
	LuCircleX,
	LuGitCommitHorizontal,
	LuLoader,
	LuRefreshCw,
	LuX,
} from "react-icons/lu";
import type { JedvParityViewContext } from "../../../../parity-types";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { useRemoteWrite } from "../../hooks/useRemoteWrite/useRemoteWrite";
import type { PullRequestTarget } from "../../types";
import { PullRequestChanges } from "../PullRequestChanges/PullRequestChanges";
import { PullRequestDraftMenu } from "../PullRequestDraftMenu";
import { PullRequestStateIcon } from "../PullRequestStateIcon/PullRequestStateIcon";
import { RemoteWriteNotice } from "../RemoteWriteNotice/RemoteWriteNotice";
export function PullRequestDetail({
	context,
	target,
	onClose,
	onUpdated,
}: {
	context: JedvParityViewContext;
	target: PullRequestTarget;
	onClose(): void;
	onUpdated(): void;
}) {
	const { client, hostUrl } = context;
	const queries = useQueryClient();
	const { t } = useLingui();
	const remoteWrite = useRemoteWrite();
	const [tab, setTabValue] = useState("summary");
	const [changesVisited, setChangesVisited] = useState(false);
	const setTab = (value: string) => {
		if (value === "changes") setChangesVisited(true);
		setTabValue(value);
	};
	const [comment, setComment] = useState("");
	const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">(
		"squash",
	);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const contentKey = [
		"jedv",
		hostUrl,
		"pr-content",
		target.owner,
		target.repo,
		target.number,
	] as const;
	const content = useQuery({
		queryKey: contentKey,
		queryFn: () =>
			client.pullRequests.getContentByRepo.query({
				repoFullName: `${target.owner}/${target.repo}`,
				prNumber: target.number,
			}),
		retry: false,
		refetchInterval: 30000,
	});
	const refreshContent = async () => {
		const fresh = await client.pullRequests.getContentByRepo.query({
			repoFullName: `${target.owner}/${target.repo}`,
			prNumber: target.number,
			forceRefresh: true,
		});
		queries.setQueryData(contentKey, fresh);
	};
	const linked = useQuery({
		queryKey: ["jedv", hostUrl, "pr-linked", target.projectId, target.number],
		queryFn: () =>
			client.pullRequests.getLinkedWorkspace.query({
				projectId: target.projectId,
				prNumber: target.number,
			}),
		retry: false,
	});
	const permissions = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			"pr-permissions",
			target.owner,
			target.repo,
			target.number,
		],
		queryFn: () =>
			client.github.getPullRequestDetail.query({
				owner: target.owner,
				repo: target.repo,
				pullNumber: target.number,
			}),
		retry: false,
		staleTime: 30000,
	});
	const allowedMethods = (
		permissions.data?.mergeability.allowedMergeMethods ?? []
	).filter(
		(method): method is "merge" | "squash" | "rebase" =>
			method === "merge" || method === "squash" || method === "rebase",
	);
	const effectiveMethod = allowedMethods.includes(mergeMethod)
		? mergeMethod
		: (allowedMethods[0] ?? "squash");
	const checkLabels = {
		success: t({ message: "Passed" }),
		failure: t({ message: "Failed" }),
		pending: t({ message: "Running" }),
		skipped: t({ message: "Skipped" }),
		cancelled: t({ message: "Cancelled" }),
	};
	const reviewLabels: Record<string, string> = {
		APPROVED: t({ message: "Approved" }),
		CHANGES_REQUESTED: t({ message: "Changes requested" }),
		COMMENTED: t({ message: "Commented" }),
		DISMISSED: t({ message: "Dismissed" }),
		PENDING: t({ message: "Pending" }),
	};
	const data = content.data;
	const state = data?.mergedAt
		? "merged"
		: (data?.state.toLowerCase() ?? "open");
	const stateLabel =
		state === "merged"
			? t({ message: "Merged" })
			: state === "closed"
				? t({ message: "Closed" })
				: data?.isDraft
					? t({ message: "Draft" })
					: t({ message: "Open" });
	const timeline = data
		? [
				...data.comments.map((item) => ({
					id: item.id,
					at: item.createdAt,
					kind: item.kind,
					author: item.author?.login ?? "",
					body: item.body,
					state: item.reviewState,
					url: item.url,
				})),
				...data.commits.map((item) => ({
					id: item.oid,
					at: item.committedDate,
					kind: "commit",
					author: item.author?.login ?? item.author?.name ?? "",
					body: item.messageHeadline,
					state: null,
					url: item.url,
				})),
			].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
		: [];
	const confirmComment = () =>
		setConfirmation({
			title: t({ message: "Post comment to GitHub?" }),
			description: t({
				message: "This comment will be visible on the remote pull request.",
			}),
			detail: `${target.owner}/${target.repo}#${target.number}\n\n${comment}`,
			execute: async () => {
				await remoteWrite.run(() =>
					client.pullRequests.addComment.mutate({
						projectId: target.projectId,
						prNumber: target.number,
						body: comment,
					}),
				);
				setComment("");
				setNotice(t({ message: "Comment posted" }));
				await refreshContent();
			},
		});
	const confirmMerge = () =>
		setConfirmation({
			title: t({ message: "Merge pull request?" }),
			description: t({
				message: "This updates the remote base branch on GitHub.",
			}),
			detail: `${target.owner}/${target.repo}#${target.number}\n${data?.title}\n${data?.branch} → ${data?.baseBranch}\n${effectiveMethod}`,
			execute: async () => {
				const result = await remoteWrite.run(() =>
					client.pullRequests.mergePR.mutate({
						projectId: target.projectId,
						prNumber: target.number,
						mergeMethod: effectiveMethod,
					}),
				);
				if (!result.merged) throw new Error(result.message);
				setNotice(t({ message: "Pull request merged" }));
				await refreshContent();
				onUpdated();
			},
		});
	return (
		<article className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border lg:border-l lg:border-t-0 bg-background">
			<div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-4">
				{[
					{ id: "summary", label: t({ message: "Summary" }) },
					{ id: "changes", label: t({ message: "Changes" }) },
					{ id: "checks", label: t({ message: "Checks" }) },
				].map((item) => (
					<button
						type="button"
						key={item.id}
						onClick={() => setTab(item.id)}
						aria-pressed={tab === item.id}
						className={cn(
							"h-7 rounded-lg px-2.5 text-xs transition-colors",
							tab === item.id
								? "bg-secondary"
								: "text-muted-foreground hover:bg-accent/60",
						)}
					>
						{item.label}
					</button>
				))}
				{data && (
					<span className="flex gap-1 text-[11px] tabular-nums">
						<span className="text-emerald-500">+{data.additions}</span>
						<span className="text-red-500">−{data.deletions}</span>
					</span>
				)}
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={() =>
							void refreshContent().catch((cause) =>
								setError(
									errorMessage(
										cause,
										t({ message: "Failed to load pull request" }),
									),
								),
							)
						}
						aria-label={t({ message: "Refresh pull request" })}
					>
						<LuRefreshCw className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={onClose}
						aria-label={t({ message: "Close detail" })}
					>
						<LuX className="size-4" />
					</Button>
				</div>
			</div>
			{remoteWrite.blocked && (
				<RemoteWriteNotice
					refreshing={remoteWrite.refreshing}
					onRefresh={() =>
						remoteWrite.refresh(async () => {
							await refreshContent();
							await permissions.refetch({ throwOnError: true });
						})
					}
				/>
			)}
			{notice && (
				<output className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
					{notice}
				</output>
			)}
			{(content.error || error) && (
				<div role="alert" className="p-4 text-xs text-destructive">
					{error ??
						errorMessage(
							content.error,
							t({ message: "Failed to load pull request" }),
						)}
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							setError(null);
							void refreshContent().catch((cause) =>
								setError(
									errorMessage(
										cause,
										t({ message: "Failed to load pull request" }),
									),
								),
							);
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			{content.isPending && (
				<output className="p-6 text-xs text-muted-foreground">
					<Trans>Loading pull request…</Trans>
				</output>
			)}
			{changesVisited && (
				<div className={tab === "changes" ? "flex min-h-0 flex-1" : "hidden"}>
					<PullRequestChanges
						client={client}
						hostUrl={hostUrl}
						target={target}
						canUpdate={permissions.data?.capabilities.update === true}
						onUpdated={async () => {
							await refreshContent();
							await permissions.refetch({ throwOnError: true });
						}}
					/>
				</div>
			)}
			{tab !== "changes" && data && (
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					<header className="shrink-0 pb-4">
						<div className="flex items-center gap-2">
							{state === "open" ? (
								<PullRequestDraftMenu
									client={client}
									target={target}
									isDraft={data.isDraft}
									canUpdate={permissions.data?.capabilities.update === true}
									canMarkReady={
										permissions.data?.capabilities.markReady === true
									}
									onUpdated={async () => {
										await refreshContent();
										await permissions.refetch({ throwOnError: true });
										onUpdated();
									}}
								/>
							) : (
								<span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
									<PullRequestStateIcon state={state} draft={data.isDraft} />
									{stateLabel}
								</span>
							)}
							<a
								href={data.url}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
							>
								{target.repo} #{target.number}
								<LuArrowUpRight className="size-3" />
							</a>
						</div>
						<h2 className="mt-3 break-words text-[1.75rem] font-semibold leading-tight tracking-tight">
							{data.title}
						</h2>
						<div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
							<span className="font-medium text-foreground">{data.author}</span>
							{data.createdAt && (
								<>
									<span>·</span>
									<time title={formatDateTime(new Date(data.createdAt))}>
										{formatCompactRelativeTime(new Date(data.createdAt))}
									</time>
								</>
							)}
							<span>·</span>
							<code className="text-[11px]">
								{data.branch} → {data.baseBranch}
							</code>
						</div>
						{data.labels.length > 0 && (
							<ul className="mt-3 flex flex-wrap gap-1.5">
								{data.labels.map((label) => (
									<li
										key={label.name}
										className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
									>
										{label.name}
									</li>
								))}
							</ul>
						)}
					</header>
					{tab === "checks" ? (
						<div className="mt-4 space-y-1">
							<h3 className="mb-3 text-sm font-medium">
								<Trans>Checks</Trans>
							</h3>
							{data.checks.length === 0 && (
								<p className="text-xs text-muted-foreground">
									<Trans>No checks reported</Trans>
								</p>
							)}
							{data.checks.map((check) => {
								const Icon =
									check.status === "success"
										? LuCheck
										: check.status === "failure"
											? LuCircleX
											: LuLoader;
								return (
									<div
										key={check.name}
										className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-xs"
									>
										<Icon
											className={cn(
												"size-3.5",
												check.status === "success"
													? "text-emerald-500"
													: check.status === "failure"
														? "text-destructive"
														: "text-muted-foreground",
											)}
										/>
										<span className="min-w-0 flex-1 truncate">
											{check.name}
										</span>
										<span className="text-muted-foreground">
											{checkLabels[check.status]}
										</span>
										{check.url && (
											<a
												href={check.url}
												target="_blank"
												rel="noreferrer"
												aria-label={t({ message: "Open check on GitHub" })}
											>
												<LuArrowUpRight className="size-3" />
											</a>
										)}
									</div>
								);
							})}
						</div>
					) : (
						<>
							{permissions.error && (
								<p role="alert" className="mb-3 text-xs text-destructive">
									{errorMessage(
										permissions.error,
										t({ message: "Could not load GitHub permissions" }),
									)}
									<Button
										size="sm"
										variant="ghost"
										onClick={() => void permissions.refetch()}
									>
										<Trans>Retry</Trans>
									</Button>
								</p>
							)}
							{linked.error && (
								<p role="alert" className="mb-3 text-xs text-destructive">
									{errorMessage(
										linked.error,
										t({ message: "Failed to find linked workspace" }),
									)}
								</p>
							)}
							{linked.data?.workspaceId && (
								<Button
									size="sm"
									variant="outline"
									className="mb-4 h-7 text-xs"
									onClick={() =>
										void context
											.onOpenWorkspace(linked.data?.workspaceId ?? "")
											.catch((cause) =>
												setError(
													errorMessage(
														cause,
														t({ message: "Failed to open workspace" }),
													),
												),
											)
									}
								>
									<Trans>Open workspace</Trans>
									<LuArrowUpRight className="size-3" />
								</Button>
							)}
							<div className="rounded-xl border border-border/60 p-4 text-[13px] leading-relaxed">
								{data.body ? (
									<MessageResponse>{data.body}</MessageResponse>
								) : (
									<p className="italic text-muted-foreground">
										<Trans>No description provided</Trans>
									</p>
								)}
							</div>
							<h3 className="mb-3 mt-6 text-sm font-medium">
								<Trans>Activity</Trans>
							</h3>
							<div className="space-y-3">
								{timeline.length === 0 && (
									<p className="text-xs text-muted-foreground">
										<Trans>No activity yet</Trans>
									</p>
								)}
								{timeline.map((item) => (
									<div
										key={`${item.kind}:${item.id}`}
										className={cn(
											"rounded-xl border border-border/60",
											item.kind === "commit"
												? "flex items-center gap-2 px-3 py-2"
												: "overflow-hidden",
										)}
									>
										{item.kind === "commit" ? (
											<>
												<LuGitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
												<span className="min-w-0 truncate text-xs">
													{item.body}
												</span>
												<a
													className="ml-auto text-[11px] text-muted-foreground"
													href={item.url ?? undefined}
													target="_blank"
													rel="noreferrer"
												>
													{item.id.slice(0, 7)}
												</a>
											</>
										) : (
											<>
												<div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 bg-muted/20 px-3 py-2 text-xs">
													<span className="font-medium">{item.author}</span>
													{item.state && (
														<span className="text-muted-foreground">
															{reviewLabels[item.state] ?? item.state}
														</span>
													)}
													<time
														className="ml-auto text-[11px] text-muted-foreground"
														title={formatDateTime(new Date(item.at))}
													>
														{formatCompactRelativeTime(new Date(item.at))}
													</time>
												</div>
												<div className="select-text px-3 py-3 text-[13px]">
													<MessageResponse>{item.body}</MessageResponse>
												</div>
											</>
										)}
									</div>
								))}
							</div>
							<div className="mt-5 rounded-xl border border-border">
								<Textarea
									aria-label={t({ message: "Comment" })}
									value={comment}
									maxLength={65536}
									onChange={(e) => setComment(e.target.value)}
									placeholder={t({ message: "Leave a comment…" })}
									className="min-h-24 resize-y border-none shadow-none focus-visible:ring-0"
								/>
								<div className="flex justify-end p-2">
									<Button
										size="sm"
										className="h-7 text-xs"
										disabled={!comment.trim() || remoteWrite.blocked}
										onClick={confirmComment}
									>
										<Trans>Comment</Trans>
									</Button>
								</div>
							</div>
							{state === "open" && !data.isDraft && (
								<div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
									<div className="min-w-0 flex-1">
										<p className="text-xs font-medium">
											{data.mergeability === "conflicting" ? (
												<Trans>This branch has conflicts</Trans>
											) : data.mergeability === "unknown" ? (
												<Trans>Mergeability is being checked</Trans>
											) : (
												<Trans>Merge pull request</Trans>
											)}
										</p>
										<p className="mt-1 text-[11px] text-muted-foreground">
											<Trans>
												GitHub enforces branch protection and required checks.
											</Trans>
										</p>
									</div>
									<Select
										value={effectiveMethod}
										onValueChange={(value) =>
											setMergeMethod(value as "merge" | "squash" | "rebase")
										}
									>
										<SelectTrigger
											className="h-7 w-28 text-xs"
											aria-label={t({ message: "Merge method" })}
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem
												value="squash"
												disabled={!allowedMethods.includes("squash")}
											>
												<Trans>Squash</Trans>
											</SelectItem>
											<SelectItem
												value="merge"
												disabled={!allowedMethods.includes("merge")}
											>
												<Trans>Merge</Trans>
											</SelectItem>
											<SelectItem
												value="rebase"
												disabled={!allowedMethods.includes("rebase")}
											>
												<Trans>Rebase</Trans>
											</SelectItem>
										</SelectContent>
									</Select>
									<Button
										size="sm"
										className="h-7 text-xs"
										disabled={
											remoteWrite.blocked ||
											data.mergeability !== "mergeable" ||
											!permissions.data?.capabilities.merge ||
											allowedMethods.length === 0
										}
										onClick={confirmMerge}
									>
										<Trans>Merge</Trans>
									</Button>
								</div>
							)}
						</>
					)}
				</div>
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</article>
	);
}
