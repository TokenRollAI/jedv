import type { TeardownFailureCause } from "@jedv/host-service";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { Workspace } from "../../types";
import type { ProjectActionContext } from "../JedvProjectActions";
import { redactProjectError } from "../JedvProjectActions/project-utils";
import { DestroyConfirmPane } from "./DestroyConfirmPane/DestroyConfirmPane";
import { TeardownFailedPane } from "./TeardownFailedPane/TeardownFailedPane";

export interface DeletedWorkspaceResult {
	context: ProjectActionContext;
	workspaceId: string;
	warnings: string[];
}
export interface JedvDeleteWorkspaceDialogProps {
	context: ProjectActionContext;
	workspace: Workspace;
	hasUnsavedFiles: boolean;
	getHasUnsavedFiles?: () => boolean;
	onRefresh(context: ProjectActionContext): Promise<void>;
	onDeleted(result: DeletedWorkspaceResult): Promise<void> | void;
	onClose(): void;
}
export function JedvDeleteWorkspaceDialog(
	props: JedvDeleteWorkspaceDialogProps,
) {
	const { t } = useLingui();
	const [target] = useState(() => ({
		context: { ...props.context },
		workspace: props.workspace,
	}));
	const { context, workspace } = target;
	const unsaved = () => props.getHasUnsavedFiles?.() ?? props.hasUnsavedFiles;
	const [deleteBranch, setDeleteBranch] = useState(false);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [teardown, setTeardown] = useState<TeardownFailureCause | null>(null);
	const forceConsent = useRef(false);
	const [completed, setCompleted] = useState<string[] | null>(null);
	const checks = useQuery({
		queryKey: [
			"jedv",
			context.hostUrl,
			"workspace-destroy-inspect",
			workspace.id,
		],
		queryFn: async () => {
			const [inspection, terminals] = await Promise.all([
				context.client.workspaceCleanup.inspect.query({
					workspaceId: workspace.id,
				}),
				context.client.terminal.list.query({ workspaceId: workspace.id }),
			]);
			return {
				inspection,
				running: terminals.sessions.filter((session) => !session.exited).length,
			};
		},
		retry: false,
		staleTime: 0,
	});
	const finish = async (warnings: string[]) => {
		await props.onRefresh(context);
		await props.onDeleted({ context, workspaceId: workspace.id, warnings });
		props.onClose();
	};
	const destroy = async (force: boolean, skipTeardown = false) => {
		if (busy.current || (completed === null && unsaved())) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			if (completed !== null) {
				await finish(completed);
				return;
			}
			if (unsaved()) return;
			const previous = JSON.stringify(checks.data);
			const fresh = await checks.refetch({ throwOnError: true });
			if (unsaved() || !fresh.data?.inspection.canDelete) {
				setError(
					t({
						message: "This workspace cannot be deleted in its current state.",
					}),
				);
				return;
			}
			if (JSON.stringify(fresh.data) !== previous) {
				setError(
					t({
						message:
							"Workspace state changed. Review the updated checks and confirm again.",
					}),
				);
				setTeardown(null);
				return;
			}
			forceConsent.current = force;
			const result = await context.client.workspaceCleanup.destroy.mutate({
				workspaceId: workspace.id,
				deleteBranch,
				force,
				skipTeardown,
			});
			const warnings = result.warnings ?? [];
			setCompleted(warnings);
			setTeardown(null);
			await finish(warnings);
		} catch (failure) {
			const data = (
				failure as {
					data?: {
						teardownFailure?: TeardownFailureCause;
						deleteInProgress?: unknown;
					};
				}
			)?.data;
			if (data?.teardownFailure) setTeardown(data.teardownFailure);
			else {
				setTeardown(null);
				setError(
					data?.deleteInProgress
						? t({
								message:
									"Another deletion is already running for this workspace. Wait and check its status; do not force a second deletion.",
							})
						: redactProjectError(
								failure instanceof Error
									? failure.message
									: t({
											message:
												"Could not delete workspace. Check its status before retrying.",
										}),
							),
				);
				if (completed === null) await checks.refetch();
			}
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const inspection = checks.data?.inspection;
	const blocked = unsaved()
		? t({
				message:
					"Save or close every unsaved file in this workspace before deleting it.",
			})
		: checks.isError
			? t({
					message:
						"Could not inspect this workspace. Retry the checks before deleting it.",
				})
			: checks.isPending
				? t({ message: "Checking workspace state…" })
				: inspection && !inspection.canDelete
					? inspection.reason
					: null;
	const extra = (
		<div className="space-y-2 px-4 pb-2 text-xs">
			<p className="break-all font-mono text-muted-foreground">
				{workspace.worktreePath}
			</p>
			<p className="break-all text-muted-foreground">
				<Trans>Target host: {context.hostLabel}</Trans>
			</p>
			{(checks.data?.running ?? 0) > 0 && (
				<p className="rounded border border-warning/30 bg-warning/10 p-2">
					<Trans>
						{checks.data?.running} running terminal sessions will stop. Worktree
						deletion may run teardown commands.
					</Trans>
				</p>
			)}
			{error && (
				<p role="alert" className="break-words text-destructive">
					{error}
				</p>
			)}
			{checks.isError && (
				<Button
					size="sm"
					variant="outline"
					disabled={pending}
					onClick={() => void checks.refetch()}
				>
					<Trans>Retry checks</Trans>
				</Button>
			)}
			{completed !== null && (
				<p>
					<Trans>
						The workspace was deleted. Continue to refresh the target host.
					</Trans>
				</p>
			)}
		</div>
	);
	const close = (open: boolean) => {
		if (!open && !busy.current) props.onClose();
	};
	if (teardown && completed === null)
		return (
			<TeardownFailedPane
				open
				onOpenChange={close}
				cause={teardown}
				pending={pending}
				onForceDelete={() => void destroy(forceConsent.current, true)}
			>
				{extra}
			</TeardownFailedPane>
		);
	return (
		<DestroyConfirmPane
			open
			onOpenChange={close}
			workspaceName={workspace.name || workspace.branch}
			isSession={workspace.type === "session"}
			sharesProjectCheckout={
				inspection?.sharesProjectCheckout ?? workspace.type === "local"
			}
			deleteBranch={deleteBranch}
			onDeleteBranchChange={setDeleteBranch}
			hasChanges={inspection?.hasChanges ?? false}
			hasUnpushedCommits={inspection?.hasUnpushedCommits ?? false}
			canConfirm={completed !== null || (!blocked && !!inspection?.canDelete)}
			blockingReason={blocked}
			pending={pending}
			confirmLabel={
				pending
					? t({ message: "Deleting…" })
					: completed !== null
						? t({ message: "Finish refreshing" })
						: inspection?.hasChanges || inspection?.hasUnpushedCommits
							? t({ message: "Delete anyway" })
							: t({ message: "Delete" })
			}
			onConfirm={() =>
				void destroy(
					inspection?.hasChanges === true ||
						inspection?.hasUnpushedCommits === true,
				)
			}
		>
			{extra}
		</DestroyConfirmPane>
	);
}
