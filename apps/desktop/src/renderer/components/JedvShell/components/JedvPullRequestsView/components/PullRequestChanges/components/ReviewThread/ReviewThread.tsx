import { errorMessage } from "@jedv/i18n/errors";
import { formatCompactRelativeTime } from "@jedv/i18n/format";
import type { PullRequestReviewThread } from "@jedv/shared/pull-request-threads";
import { MessageResponse } from "@jedv/ui/ai-elements/message";
import { Button } from "@jedv/ui/button";
import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { LocalClient } from "../../../../../../local-client";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../../../JedvConfirmDialog/JedvConfirmDialog";
import { useRemoteWrite } from "../../../../hooks/useRemoteWrite/useRemoteWrite";
import type { PullRequestTarget } from "../../../../types";
import { RemoteWriteNotice } from "../../../RemoteWriteNotice/RemoteWriteNotice";
export function ReviewThread({
	thread,
	client,
	target,
	viewerLogin,
	canUpdate,
	onUpdated,
	initialUi,
	onUiChange,
}: {
	thread: PullRequestReviewThread;
	client: LocalClient;
	target: PullRequestTarget;
	viewerLogin: string | null;
	canUpdate: boolean;
	onUpdated(): Promise<void>;
	initialUi?: { reply: string; expanded: boolean; blocked?: boolean };
	onUiChange?(value: {
		reply: string;
		expanded: boolean;
		blocked?: boolean;
	}): void;
}) {
	const { t } = useLingui();
	const remoteWrite = useRemoteWrite({
		initialBlocked: initialUi?.blocked,
		onBlockedChange: (blocked) => onUiChange?.({ reply, expanded, blocked }),
	});
	const [reply, setReplyValue] = useState(initialUi?.reply ?? "");
	const [expanded, setExpanded] = useState(
		initialUi?.expanded ?? (!thread.isResolved && !thread.isOutdated),
	);
	const setReply = (value: string) => {
		setReplyValue(value);
		onUiChange?.({ reply: value, expanded, blocked: remoteWrite.blocked });
	};
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const commentId = thread.comments[0]?.databaseId;
	const canReply = !!viewerLogin && !!commentId;
	const canResolve =
		canUpdate ||
		(!!viewerLogin &&
			thread.comments[0]?.author.login.toLowerCase() ===
				viewerLogin.toLowerCase());
	const action = useMutation({
		mutationFn: async (
			input:
				| { kind: "reply"; body: string }
				| { kind: "resolve"; resolved: boolean },
		) => {
			if (input.kind === "reply") {
				if (!canReply || !commentId)
					throw new Error(
						t({
							message:
								"This thread has no comment to reply to, or GitHub authentication is unavailable.",
						}),
					);
				await remoteWrite.run(() =>
					client.pullRequests.replyToThread.mutate({
						projectId: target.projectId,
						prNumber: target.number,
						commentId,
						body: input.body,
					}),
				);
			} else {
				if (!canResolve)
					throw new Error(
						t({ message: "You do not have permission to resolve this thread" }),
					);
				await remoteWrite.run(() =>
					client.pullRequests.setThreadResolution.mutate({
						threadId: thread.id,
						resolved: input.resolved,
					}),
				);
			}
			return input.kind;
		},
		onSuccess: async (kind) => {
			if (kind === "reply") setReply("");
			await onUpdated();
		},
	});
	const confirmReply = () => {
		const body = reply.trim();
		if (!body || !canReply || action.isPending || remoteWrite.blocked) return;
		setConfirmation({
			title: t({ message: "Post reply to GitHub?" }),
			description: t({
				message: "This reply will be visible in the remote review thread.",
			}),
			detail: `${target.owner}/${target.repo}#${target.number}\n${thread.path}:${thread.line ?? ""}\n\n${body}`,
			execute: async () => {
				await action.mutateAsync({ kind: "reply", body });
			},
		});
	};
	const confirmResolve = () => {
		if (!canResolve || action.isPending || remoteWrite.blocked) return;
		setConfirmation({
			title: thread.isResolved
				? t({ message: "Unresolve conversation?" })
				: t({ message: "Resolve conversation?" }),
			description: t({ message: "This updates the review thread on GitHub." }),
			detail: `${target.owner}/${target.repo}#${target.number}\n${thread.path}:${thread.line ?? ""}`,
			execute: async () => {
				await action.mutateAsync({
					kind: "resolve",
					resolved: !thread.isResolved,
				});
			},
		});
	};
	return (
		<details
			open={expanded}
			onToggle={(event) => {
				const next = event.currentTarget.open;
				setExpanded(next);
				onUiChange?.({ reply, expanded: next, blocked: remoteWrite.blocked });
			}}
			className="w-full whitespace-normal border-y border-border/50 bg-muted/20 font-sans text-card-foreground"
		>
			<summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">
				{thread.comments[0]?.author.login} ·{" "}
				{thread.isResolved ? (
					<Trans>Resolved</Trans>
				) : thread.isOutdated ? (
					<Trans>Outdated</Trans>
				) : (
					<Trans>Review thread</Trans>
				)}
			</summary>
			<div className="divide-y divide-border/50">
				{thread.comments.map((comment) => (
					<div key={comment.id} className="px-3 py-3">
						<div className="mb-2 flex items-center gap-2 text-xs">
							<span className="font-medium">{comment.author.login}</span>
							<span className="text-muted-foreground">
								{formatCompactRelativeTime(new Date(comment.createdAt))}
							</span>
						</div>
						<div className="text-[13px]">
							<MessageResponse>{comment.body}</MessageResponse>
						</div>
					</div>
				))}
			</div>
			<div className="flex flex-col gap-2 border-t border-border/50 bg-muted/20 px-3 py-2">
				<Textarea
					aria-label={t({ message: "Write a reply…" })}
					value={reply}
					onChange={(e) => setReply(e.target.value)}
					onKeyDown={(e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
							e.preventDefault();
							confirmReply();
						}
					}}
					placeholder={t({ message: "Write a reply…" })}
					rows={2}
					disabled={!canReply || action.isPending}
					className="resize-none bg-background text-xs"
				/>
				{!viewerLogin && (
					<p className="text-xs text-muted-foreground">
						<Trans>Sign in to GitHub on this host to reply</Trans>
					</p>
				)}
				{!commentId && (
					<p className="text-xs text-muted-foreground">
						<Trans>This thread has no comment to reply to.</Trans>
					</p>
				)}
				{!canResolve && (
					<p className="text-xs text-muted-foreground">
						<Trans>
							Only the thread author or a user with pull request write access
							can resolve this conversation.
						</Trans>
					</p>
				)}
				{remoteWrite.blocked && (
					<RemoteWriteNotice
						refreshing={remoteWrite.refreshing}
						onRefresh={() => remoteWrite.refresh(onUpdated)}
					/>
				)}
				{action.error && (
					<p
						role="alert"
						className="whitespace-pre-wrap text-xs text-destructive"
					>
						{errorMessage(
							action.error,
							t({ message: "Failed to update review thread" }),
						)}
					</p>
				)}
				{action.isSuccess && (
					<output className="text-xs text-muted-foreground">
						<Trans>Review thread updated</Trans>
					</output>
				)}
				<div className="flex items-center justify-end gap-2">
					<Button
						type="button"
						size="xs"
						variant="outline"
						disabled={remoteWrite.blocked || !canResolve || action.isPending}
						onClick={confirmResolve}
					>
						{thread.isResolved ? (
							<Trans>Unresolve</Trans>
						) : (
							<Trans>Resolve conversation</Trans>
						)}
					</Button>
					<Button
						type="button"
						size="xs"
						disabled={
							remoteWrite.blocked ||
							!reply.trim() ||
							!canReply ||
							action.isPending
						}
						onClick={confirmReply}
					>
						{action.isPending ? <Trans>Saving…</Trans> : <Trans>Reply</Trans>}
					</Button>
				</div>
			</div>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</details>
	);
}
