import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import type { Workspace } from "../../../types";
import type { ProjectActionContext } from "../../JedvProjectActions";
export function RestoreWorkspaceButton({
	context,
	workspace,
	onRestored,
	initialOpen = false,
	onDismiss,
}: {
	context: ProjectActionContext;
	workspace: Workspace;
	initialOpen?: boolean;
	onDismiss?(): void;
	onRestored(result: {
		context: ProjectActionContext;
		workspaceId: string;
	}): Promise<void>;
}) {
	const { t } = useLingui();
	const [target] = useState(() => ({ ...context }));
	const [open, setOpen] = useState(initialOpen);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	return (
		<>
			<Button
				hidden={initialOpen}
				size="sm"
				variant="outline"
				disabled={
					workspace.type === "session" ||
					!workspace.projectId ||
					workspace.archivedAt == null
				}
				onClick={() => setOpen(true)}
			>
				<Trans>Restore workspace…</Trans>
			</Button>
			{open && (
				<Dialog
					open
					modal
					onOpenChange={(value) => {
						if (!value && !busy.current) {
							setOpen(false);
							onDismiss?.();
						}
					}}
				>
					<DialogContent showCloseButton={!pending}>
						<DialogHeader>
							<DialogTitle>
								<Trans>Restore workspace?</Trans>
							</DialogTitle>
							<DialogDescription>
								{workspace.type === "local" ? (
									<Trans>
										Restore this workspace record on the shared repository
										checkout. Terminated terminal sessions are not restarted.
									</Trans>
								) : (
									<Trans>
										Recreate the worktree from committed branch history, then
										run the project's setup script if configured. Deleted
										uncommitted files and terminated sessions cannot be
										recovered.
									</Trans>
								)}
							</DialogDescription>
						</DialogHeader>
						<p className="break-all text-sm font-medium">
							{workspace.name || workspace.branch}
						</p>
						<p className="break-all font-mono text-xs text-muted-foreground">
							{workspace.worktreePath}
						</p>
						{error && (
							<p role="alert" className="text-xs text-destructive">
								{error}
							</p>
						)}
						<DialogFooter>
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() => {
									setOpen(false);
									onDismiss?.();
								}}
							>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								disabled={pending}
								onClick={async () => {
									if (busy.current) return;
									busy.current = true;
									setPending(true);
									setError(null);
									try {
										if (!saved) {
											await target.client.workspaces.restore.mutate({
												workspaceId: workspace.id,
											});
											setSaved(true);
										}
										await onRestored({
											context: target,
											workspaceId: workspace.id,
										});
										setOpen(false);
									} catch {
										setError(
											t({
												message:
													"Could not finish restoring the workspace. Check the target host; an occupied path or unavailable branch blocks restoration.",
											}),
										);
									} finally {
										busy.current = false;
										setPending(false);
									}
								}}
							>
								{pending ? (
									<Trans>Restoring…</Trans>
								) : saved ? (
									<Trans>Finish refreshing</Trans>
								) : (
									<Trans>Restore workspace</Trans>
								)}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
