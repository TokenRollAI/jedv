import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useRef, useState } from "react";
import {
	LuCheck,
	LuCopy,
	LuGitBranch,
	LuPencil,
	LuPin,
	LuPinOff,
	LuRotateCcw,
	LuTrash2,
	LuUnlink,
} from "react-icons/lu";
import type { Workspace } from "../../../../types";
import { RestoreWorkspaceButton } from "../../../JedvDeleteWorkspaceDialog";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import { JedvRowMenu, type RowAction } from "../../../JedvRowMenu";
import { WorkspaceRenameDialog } from "../WorkspaceRenameDialog";
export function WorkspaceBoardActions({
	children,
	context,
	workspace,
	pinned,
	pinAvailable,
	pinPending,
	onTogglePin,
	onDelete,
	canDelete,
	onChanged,
	onRestored,
	onMarkRead,
	onMarkUnread,
	unread,
	hasPullRequest,
}: {
	children: ReactNode;
	context: ProjectActionContext;
	workspace: Workspace;
	pinned: boolean;
	pinAvailable: boolean;
	pinPending: boolean;
	onTogglePin(): Promise<void>;
	onDelete(): void;
	canDelete: boolean;
	onChanged(context: ProjectActionContext): Promise<void>;
	onRestored(result: {
		context: ProjectActionContext;
		workspaceId: string;
	}): Promise<void>;
	onMarkRead(): void;
	onMarkUnread(): void;
	unread: boolean;
	hasPullRequest: boolean;
}) {
	const { t } = useLingui();
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [renaming, setRenaming] = useState(false);
	const archived = workspace.archivedAt != null;
	const run = async (work: () => Promise<unknown>) => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await work();
		} catch {
			setError(t({ message: "Could not update workspace. Try again." }));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const actions: RowAction[] = [
		...(!archived
			? [
					{
						label: pinned
							? t({ message: "Unpin workspace" })
							: t({ message: "Pin workspace" }),
						icon: pinned ? (
							<LuPinOff className="size-4" />
						) : (
							<LuPin className="size-4" />
						),
						disabled: pending || pinPending || !pinAvailable,
						disabledReason: !pinAvailable
							? t({
									message:
										"Workspace pinning and ordering are unavailable on this host.",
								})
							: undefined,
						run: () => void run(onTogglePin),
					},
					{
						label: t({ message: "Rename" }),
						icon: <LuPencil className="size-4" />,
						disabled: pending,
						separator: true,
						run: () => setRenaming(true),
					},
				]
			: []),
		{
			label: t({ message: "Copy Branch Name" }),
			icon: <LuGitBranch className="size-4" />,
			disabled: pending,
			separator: true,
			run: () =>
				void run(() => navigator.clipboard.writeText(workspace.branch)),
		},
		...(workspace.worktreePath
			? [
					{
						label: t({ message: "Copy Path" }),
						icon: <LuCopy className="size-4" />,
						disabled: pending,
						run: () =>
							void run(() =>
								navigator.clipboard.writeText(workspace.worktreePath ?? ""),
							),
					},
				]
			: []),
		{
			label: t({ message: "Copy Workspace ID" }),
			icon: <LuCopy className="size-4" />,
			disabled: pending,
			run: () => void run(() => navigator.clipboard.writeText(workspace.id)),
		},
		...(!archived
			? [
					{
						label: unread
							? t({ message: "Mark as read" })
							: t({ message: "Mark as unread" }),
						icon: <LuCheck className="size-4" />,
						disabled: pending,
						separator: true,
						run: unread ? onMarkRead : onMarkUnread,
					},
					{
						label: t({ message: "Clear Status" }),
						icon: <LuRotateCcw className="size-4" />,
						disabled: pending,
						run: () =>
							void run(async () => {
								const target = { ...context };
								await target.client.terminalAgents.clearWorkspaceStatuses.mutate(
									{ workspaceId: workspace.id },
								);
								await onChanged(target);
							}),
					},
					...(hasPullRequest
						? [
								{
									label: t({ message: "Remove pull request link" }),
									icon: <LuUnlink className="size-4" />,
									disabled: pending,
									run: () =>
										void run(async () => {
											const target = { ...context };
											await target.client.pullRequests.unlinkFromWorkspace.mutate(
												{ workspaceId: workspace.id },
											);
											await onChanged(target);
										}),
								},
							]
						: []),
					{
						label: t({ message: "Delete Workspace…" }),
						icon: <LuTrash2 className="size-4" />,
						destructive: true,
						disabled: pending || !canDelete,
						disabledReason: !canDelete
							? t({
									message:
										"Unsaved file protection is unavailable. Delete this workspace from the sidebar.",
								})
							: undefined,
						separator: true,
						run: onDelete,
					},
				]
			: []),
	];
	return (
		<article className="relative">
			<JedvRowMenu
				actions={actions}
				className="items-start [&>button:last-child]:top-2"
			>
				{children}
			</JedvRowMenu>
			{archived && (
				<div className="px-2 pb-1 pt-2">
					<RestoreWorkspaceButton
						context={context}
						workspace={workspace}
						onRestored={onRestored}
					/>
					{workspace.type === "session" && (
						<p className="mt-1 text-xs text-muted-foreground">
							<Trans>Deleted sessions cannot be restored.</Trans>
						</p>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="mt-1 break-words text-xs text-destructive">
					{error}
				</p>
			)}
			{renaming && (
				<WorkspaceRenameDialog
					context={context}
					workspace={workspace}
					onChanged={onChanged}
					onClose={() => setRenaming(false)}
				/>
			)}
		</article>
	);
}
