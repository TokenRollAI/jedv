import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { Checkbox } from "@jedv/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { JedvParityViewContext } from "../../../../parity-types";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { useRemoteWrite } from "../../hooks/useRemoteWrite/useRemoteWrite";
import { RemoteWriteNotice } from "../RemoteWriteNotice/RemoteWriteNotice";
export function CreatePullRequestDialog({
	context,
	onClose,
	onCreated,
	inline = false,
	initialWorkspaceId,
}: {
	context: JedvParityViewContext;
	onClose(): void;
	onCreated(): void;
	inline?: boolean;
	initialWorkspaceId?: string;
}) {
	const { t } = useLingui();
	const remoteWrite = useRemoteWrite();
	const candidates = context.workspaces.filter(
		(w) =>
			w.archivedAt == null &&
			w.worktreeExists &&
			context.projects.some(
				(p) => p.id === w.projectId && p.repoOwner && p.repoName,
			),
	);
	const [workspaceId, setWorkspaceId] = useState(
		initialWorkspaceId ?? candidates[0]?.id ?? "",
	);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [draft, setDraft] = useState(false);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const workspace = candidates.find((w) => w.id === workspaceId);
	const project = context.projects.find((p) => p.id === workspace?.projectId);
	const repoInput =
		project?.repoOwner && project.repoName
			? { owner: project.repoOwner, repo: project.repoName }
			: null;
	const repo = useQuery({
		queryKey: ["jedv", context.hostUrl, "create-pr-repo", repoInput],
		queryFn: repoInput
			? () => context.client.github.getRepo.query(repoInput)
			: skipToken,
		retry: false,
	});
	const canPush =
		repo.data?.permissions?.push === true ||
		repo.data?.permissions?.admin === true ||
		repo.data?.permissions?.maintain === true;
	const create = useMutation({
		mutationFn: () =>
			remoteWrite.run(() =>
				context.client.pullRequests.createForWorkspace.mutate({
					workspaceId,
					title: title.trim(),
					body: body.trim(),
					draft,
				}),
			),
		onSuccess: () => {
			onCreated();
			onClose();
		},
	});
	const valid =
		!!workspace && !!title.trim() && canPush && !remoteWrite.blocked;
	const submit = () => {
		if (!valid) return;
		setConfirmation({
			title: t({ message: "Create pull request on GitHub?" }),
			description: t({
				message:
					"This creates a remote pull request from the workspace branch.",
			}),
			detail: `${project?.repoOwner}/${project?.repoName}\n${workspace?.name || workspace?.branch}\n${workspace?.branch}\n${draft ? t({ message: "Draft" }) : t({ message: "Ready for review" })}\n\n${title.trim()}\n\n${body.trim()}`,
			execute: async () => {
				await create.mutateAsync();
			},
		});
	};
	const form = (
		<>
			<form
				className="flex flex-col gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<Select value={workspaceId} onValueChange={setWorkspaceId}>
					<SelectTrigger
						className="h-8 text-xs"
						aria-label={t({ message: "Workspace" })}
					>
						<SelectValue placeholder={t({ message: "Choose a workspace" })} />
					</SelectTrigger>
					<SelectContent>
						{candidates.map((w) => (
							<SelectItem key={w.id} value={w.id}>
								{w.name || w.branch} · {w.branch}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					value={title}
					required
					onChange={(e) => setTitle(e.target.value)}
					aria-label={t({ message: "Pull request title" })}
					placeholder={t({ message: "Pull request title" })}
					className="h-8 text-xs"
				/>
				<Textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					aria-label={t({ message: "Description (optional)" })}
					placeholder={t({ message: "Description (optional)" })}
					className="min-h-20 text-xs"
				/>
				<label
					htmlFor="create-pr-draft"
					className="flex items-center gap-1.5 text-xs text-muted-foreground"
				>
					<Checkbox
						id="create-pr-draft"
						checked={draft}
						onCheckedChange={(value) => setDraft(value === true)}
					/>
					<Trans>Draft</Trans>
				</label>
				{!candidates.length && (
					<p className="text-xs text-muted-foreground">
						<Trans>No available workspace with a GitHub remote</Trans>
					</p>
				)}
				{repo.isFetching && (
					<output className="text-xs text-muted-foreground">
						<Trans>Checking repository access…</Trans>
					</output>
				)}
				{repo.error && (
					<p role="alert" className="text-xs text-destructive">
						{errorMessage(
							repo.error,
							t({ message: "Could not load GitHub permissions" }),
						)}
						<Button
							size="sm"
							variant="ghost"
							type="button"
							onClick={() => void repo.refetch()}
						>
							<Trans>Retry</Trans>
						</Button>
					</p>
				)}
				{repo.data && !canPush && (
					<p role="alert" className="text-xs text-muted-foreground">
						<Trans>
							Write access to this repository is required to create a pull
							request from this workspace.
						</Trans>
					</p>
				)}
				{remoteWrite.blocked && (
					<RemoteWriteNotice
						refreshing={remoteWrite.refreshing}
						onRefresh={() =>
							remoteWrite.refresh(async () => {
								if (!repoInput || !workspace)
									throw new Error(t({ message: "Choose a workspace" }));
								const existing = await context.client.github.getPRStatus.query({
									...repoInput,
									branch: workspace.branch,
								});
								if (existing)
									throw new Error(
										t({
											message:
												"A pull request already exists for this branch. Refresh the pull request list.",
										}),
									);
							})
						}
					/>
				)}
				{create.error && (
					<p role="alert" className="text-xs text-destructive">
						{errorMessage(
							create.error,
							t({ message: "Failed to create pull request" }),
						)}
					</p>
				)}
				<DialogFooter className="mt-2">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={create.isPending}
						onClick={onClose}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="submit"
						size="sm"
						disabled={!valid || repo.isFetching || create.isPending}
					>
						{create.isPending ? (
							<Trans>Creating…</Trans>
						) : (
							<Trans>Create pull request</Trans>
						)}
					</Button>
				</DialogFooter>
			</form>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</>
	);
	if (inline) return <div className="p-1">{form}</div>;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !create.isPending && !confirmation) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Create pull request</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Create a pull request from an existing workspace branch. Its
							configured base branch is used.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				{form}
			</DialogContent>
		</Dialog>
	);
}
