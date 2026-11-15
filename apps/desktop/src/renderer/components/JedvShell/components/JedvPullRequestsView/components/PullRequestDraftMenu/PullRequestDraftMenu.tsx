import { errorMessage } from "@jedv/i18n/errors";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { LocalClient } from "../../../../local-client";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { useRemoteWrite } from "../../hooks/useRemoteWrite/useRemoteWrite";
import type { PullRequestTarget } from "../../types";
import { PullRequestStateIcon } from "../PullRequestStateIcon";
import { RemoteWriteNotice } from "../RemoteWriteNotice/RemoteWriteNotice";
export function PullRequestDraftMenu({
	client,
	target,
	isDraft,
	canUpdate,
	canMarkReady,
	onUpdated,
}: {
	client: LocalClient;
	target: PullRequestTarget;
	isDraft: boolean;
	canUpdate: boolean;
	canMarkReady: boolean;
	onUpdated(): Promise<void>;
}) {
	const { t } = useLingui();
	const remoteWrite = useRemoteWrite();
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const change = useMutation({
		mutationFn: (draft: boolean) =>
			remoteWrite.run(() =>
				client.pullRequests.setDraft.mutate({
					projectId: target.projectId,
					prNumber: target.number,
					draft,
				}),
			),
		onSuccess: onUpdated,
	});
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={
						remoteWrite.blocked ||
						change.isPending ||
						(!canUpdate && !canMarkReady)
					}
					aria-label={t({ message: "Change state" })}
					className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-2 pr-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70"
				>
					<PullRequestStateIcon state="open" draft={isDraft} />
					{change.isPending ? (
						change.variables ? (
							<Trans>Converting to draft…</Trans>
						) : (
							<Trans>Marking ready…</Trans>
						)
					) : isDraft ? (
						<Trans>Draft</Trans>
					) : (
						<Trans>Open</Trans>
					)}
					<LuChevronDown className="size-3" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-52">
					<DropdownMenuRadioGroup
						value={isDraft ? "draft" : "ready"}
						onValueChange={(value) => {
							const draft = value === "draft";
							if (draft === isDraft || (draft ? !canUpdate : !canMarkReady))
								return;
							setConfirmation({
								title: draft
									? t({ message: "Convert to draft?" })
									: t({ message: "Mark ready for review?" }),
								description: t({
									message: "This changes the pull request state on GitHub.",
								}),
								detail: `${target.owner}/${target.repo}#${target.number}\n${target.title}`,
								execute: async () => {
									await change.mutateAsync(draft);
								},
							});
						}}
					>
						<DropdownMenuRadioItem value="draft" disabled={!canUpdate}>
							<Trans>Draft</Trans>
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem
							value="ready"
							disabled={!canMarkReady && isDraft}
						>
							<Trans>Ready for review</Trans>
						</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{remoteWrite.blocked && (
				<RemoteWriteNotice
					refreshing={remoteWrite.refreshing}
					onRefresh={() => remoteWrite.refresh(onUpdated)}
				/>
			)}
			{change.error && (
				<span role="alert" className="text-xs text-destructive">
					{errorMessage(
						change.error,
						t({ message: "Failed to update pull request state" }),
					)}
				</span>
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</>
	);
}
