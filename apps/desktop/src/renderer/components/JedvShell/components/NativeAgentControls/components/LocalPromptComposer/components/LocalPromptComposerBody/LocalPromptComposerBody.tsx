import {
	MAX_ATTACHMENTS,
	MAX_INLINE_ATTACHMENT_BYTES,
} from "@jedv/shared/attachment-limits";
import { WORKSPACE_ATTACHMENTS_DIR } from "@jedv/shared/workspace-attachments";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	usePromptInputController,
} from "@jedv/ui/ai-elements/prompt-input";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Paperclip } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";

import {
	resolveWorkspaceFilePath,
	withinWorkspace,
} from "../../../../../JedvFilesView/utils/workspace-path";
import type { LocalPromptComposerProps } from "../../props";
import {
	AttachmentCopyError,
	copyPromptAttachments,
} from "../../utils/copy-attachments";
import {
	discardLocalPromptDraft,
	prepareLocalPrompt,
} from "../../utils/prompt";
import { ScreenshotAttachmentPicker } from "../ScreenshotAttachmentPicker";
import { TiptapPromptEditor } from "../TiptapPromptEditor";
export function LocalPromptComposerBody({
	client,
	hostUrl,
	workspaceId,
	targetKey,
	draft,
	remote,
	disabled,
	submitLabel,
	onSubmitText,
}: LocalPromptComposerProps) {
	const { t } = useLingui();
	const controller = usePromptInputController();

	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [screenshots, setScreenshots] = useState(false);
	const [revision, setRevision] = useState(0);
	const current = useRef({ client, hostUrl, workspaceId, targetKey });
	current.current = { client, hostUrl, workspaceId, targetKey };
	const submission = useRef<{ scope: typeof current.current } | null>(null);
	const submitting = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const workspace = useQuery({
		queryKey: ["jedv", hostUrl, "files-workspace", workspaceId],
		queryFn: () => client.workspace.get.query({ id: workspaceId }),
		retry: false,
	});
	const root = workspace.data?.worktreePath ?? "";
	const hasDraft = !!draft.text.trim() || draft.attachments.get().length > 0;
	if (!draft.targetKey || (!hasDraft && !submitting.current))
		draft.targetKey = targetKey;
	const mismatch = draft.targetKey !== targetKey;
	const locked = disabled || pending || mismatch || draft.copyUnknown;
	useEffect(() => {
		if (!submitting.current) draft.text = controller.textInput.value;
	}, [draft, controller.textInput.value]);
	const searchFiles = useCallback(
		async (query: string) => {
			const { matches } = await client.filesystem.searchFiles.query({
				workspaceId,
				query,
				includeHidden: false,
				limit: 20,
			});
			return matches
				.filter((match) => root && withinWorkspace(root, match.absolutePath))
				.map((match) => ({
					id: match.absolutePath,
					name: match.name,
					relativePath: match.relativePath,
				}));
		},
		[client, workspaceId, root],
	);
	const submit = async (message: PromptInputMessage) => {
		if (!submission.current)
			throw new Error(t({ message: "This prompt is no longer active." }));
		const original = submission.current.scope;
		setPending(true);
		setError(null);
		try {
			if (
				!mounted.current ||
				current.current.client !== original.client ||
				current.current.hostUrl !== original.hostUrl ||
				current.current.workspaceId !== original.workspaceId ||
				current.current.targetKey !== original.targetKey
			)
				throw new Error(
					t({
						message: "The active session changed. The prompt was not sent.",
					}),
				);
			if (message.files.length && (remote || !root))
				throw new Error(
					t({
						message: "Attachments are available for local workspaces only.",
					}),
				);
			const paths = await copyPromptAttachments({
				files: message.files,
				draft,
				write: (items) =>
					electronTrpcClient.attachments.writeIntoWorktree.mutate({
						worktreePath: root,
						items,
					}),
			});
			if (paths.some((path) => !resolveWorkspaceFilePath(root, path)))
				throw new Error(
					t({ message: "The attachment path is outside this workspace." }),
				);
			if (
				!mounted.current ||
				current.current.client !== original.client ||
				current.current.hostUrl !== original.hostUrl ||
				current.current.workspaceId !== original.workspaceId ||
				current.current.targetKey !== original.targetKey
			)
				throw new Error(
					t({
						message: "The active session changed. The prompt was not sent.",
					}),
				);
			const text = prepareLocalPrompt(message.text, paths);
			if (!text) return;
			await onSubmitText(text);
			draft.text = "";
			draft.paths.clear();
			controller.textInput.clear();
		} catch (cause) {
			setError(
				cause instanceof AttachmentCopyError
					? cause.reason === "unreadable"
						? t({ message: "The attachment could not be read." })
						: cause.reason === "incomplete"
							? t({
									message:
										"The attachment copy result is incomplete. Check the workspace before retrying.",
								})
							: t({
									message: `Attachment ${(cause.index ?? 0) + 1} could not be copied: ${cause.problem}`,
								})
					: cause instanceof Error
						? cause.message
						: String(cause),
			);
			throw cause;
		} finally {
			setPending(false);
		}
	};
	void revision;
	return (
		<div className="space-y-2">
			{mismatch && (
				<div role="alert" className="space-y-1 text-xs text-muted-foreground">
					<p>
						<Trans>
							This draft belongs to another session. Return to it or discard the
							draft before composing here.
						</Trans>
					</p>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs"
						onClick={() => {
							if (
								window.confirm(
									t({
										message:
											"Discard this unsent draft and its selected attachments?",
									}),
								)
							) {
								discardLocalPromptDraft(draft, targetKey);
								controller.textInput.clear();
								setRevision((value) => value + 1);
							}
						}}
					>
						<Trans>Discard draft</Trans>
					</Button>
				</div>
			)}
			{draft.copyUnknown && (
				<div role="alert" className="space-y-1 text-xs text-muted-foreground">
					<p>
						<Trans>
							Some files may already have been copied. Check the workspace
							attachments folder before retrying.
						</Trans>
					</p>
					<p className="break-all">
						{root}/{WORKSPACE_ATTACHMENTS_DIR}
					</p>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs"
						onClick={() => {
							draft.copyUnknown = false;
							setRevision((value) => value + 1);
						}}
					>
						<Trans>I checked the attachments</Trans>
					</Button>
				</div>
			)}
			<PromptInput
				onSubmitCapture={(event) => {
					if (locked || submitting.current) {
						event.preventDefault();
						event.stopPropagation();
					}
				}}
				multiple
				maxFiles={remote ? 0 : MAX_ATTACHMENTS}
				maxFileSize={MAX_INLINE_ATTACHMENT_BYTES}
				onSubmitStart={() => {
					if (locked || submitting.current) return;
					submitting.current = true;
					submission.current = { scope: current.current };
					draft.text = controller.textInput.value;
					setPending(true);
				}}
				onSubmitEnd={() => {
					submitting.current = false;
					submission.current = null;
					setPending(false);
				}}
				onError={(cause) => setError(cause.message)}
				onSubmit={submit}
				className="rounded-[13px] bg-background [&>[data-slot=input-group]]:rounded-[13px] [&>[data-slot=input-group]]:border-[0.5px] [&>[data-slot=input-group]]:shadow-none [&>[data-slot=input-group]]:bg-foreground/[0.02]"
			>
				<fieldset disabled={locked} className="contents">
					<PromptInputAttachments>
						{(file) => <PromptInputAttachment data={file} />}
					</PromptInputAttachments>
					<TiptapPromptEditor
						cwd={root}
						searchFiles={searchFiles}
						slashCommands={[]}
						disabled={locked}
						placeholder={t({ message: "Ask to make changes, @mention files" })}
					/>
					<PromptInputFooter>
						<div className="flex items-center gap-1">
							<PromptInputActionMenu>
								<PromptInputActionMenuTrigger
									disabled={locked || remote}
									aria-label={t({ message: "Attach files" })}
									title={
										remote
											? t({
													message:
														"Attachments are available for local workspaces only.",
												})
											: t({ message: "Attach files" })
									}
								>
									<Paperclip className="size-3.5" />
								</PromptInputActionMenuTrigger>
								<PromptInputActionMenuContent>
									<PromptInputActionAddAttachments />
								</PromptInputActionMenuContent>
							</PromptInputActionMenu>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7"
								disabled={locked || remote}
								title={t({ message: "Screenshots" })}
								aria-label={t({ message: "Screenshots" })}
								onClick={() => setScreenshots(true)}
							>
								<ImagePlus className="size-3.5" />
							</Button>
						</div>
						<PromptInputSubmit
							disabled={
								locked ||
								(!controller.textInput.value.trim() &&
									!controller.attachments.files.length)
							}
							aria-label={submitLabel}
							title={submitLabel}
							className="h-7 w-auto rounded-md px-2 text-xs"
						>
							{submitLabel}
						</PromptInputSubmit>
					</PromptInputFooter>
				</fieldset>
			</PromptInput>
			{(error || workspace.error) && (
				<p
					role="alert"
					className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-destructive"
				>
					{error || workspace.error?.message}
				</p>
			)}
			<ScreenshotAttachmentPicker
				open={screenshots}
				onOpenChange={setScreenshots}
				disabled={locked || remote}
				onAdd={({ filename, base64 }) => {
					const bytes = Uint8Array.from(atob(base64), (character) =>
						character.charCodeAt(0),
					);
					controller.attachments.add([
						new File([bytes], filename, { type: "image/png" }),
					]);
				}}
			/>
		</div>
	);
}
