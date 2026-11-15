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
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import type { Project } from "../../../types";
import type { ProjectActionContext } from "../types";

import { removalRiskFingerprint } from "./removal-risk";

export function ProjectRemovalDialog({
	project,
	context,
	hasUnsavedFiles,
	getHasUnsavedFiles,
	onRemove,
	onClose,
}: {
	project: Project;
	context: ProjectActionContext;
	hasUnsavedFiles: boolean;
	getHasUnsavedFiles?: () => boolean;
	onRemove(context: ProjectActionContext, project: Project): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const [acknowledged, setAcknowledged] = useState(false);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const checks = useQuery({
		queryKey: ["jedv", context.hostUrl, "project-removal-checks", project.id],
		queryFn: async () => {
			const [impact, workspaces] = await Promise.all([
				context.client.project.deletionImpact.query({ projectId: project.id }),
				context.client.workspace.list.query(),
			]);
			const rows = await Promise.all(
				workspaces
					.filter((item) => item.projectId === project.id)
					.map(async (workspace) => {
						const [git, inspection] = await Promise.all([
							context.client.git.getStatus.query({ workspaceId: workspace.id }),
							context.client.workspaceCleanup.inspect.query({
								workspaceId: workspace.id,
							}),
						]);
						return {
							id: workspace.id,
							name: workspace.name || workspace.branch,
							dirty: git.staged.length > 0 || git.unstaged.length > 0,
							unpushed:
								git.currentBranch.aheadCount > 0 ||
								inspection.hasUnpushedCommits,
							blocked: !inspection.canDelete,
						};
					}),
			);
			return { impact, rows };
		},
		retry: false,
		staleTime: 0,
	});
	const warnings =
		checks.data?.rows.filter((row) => row.dirty || row.unpushed) ?? [];
	const hasRunning =
		checks.data?.impact.some(
			(row) => row.runningTerminalCount > 0 || row.runningAgentCount > 0,
		) ?? false;
	const latestUnsaved = () => getHasUnsavedFiles?.() ?? hasUnsavedFiles;
	const blocked =
		latestUnsaved() ||
		checks.isError ||
		checks.isPending ||
		checks.data?.rows.some((row) => row.blocked);
	const needsAcknowledgment = warnings.length > 0 || hasRunning;
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!pending}
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Remove from Jedv…</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Remove this project and its workspaces from Jedv and stop their
							terminals. Repository files stay on disk. Teardown commands may
							run.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<p className="break-all text-sm font-medium">{project.name}</p>
				<p className="break-all font-mono text-xs text-muted-foreground">
					{project.repoPath}
				</p>
				<p className="break-all text-xs text-muted-foreground">
					<Trans>Target host: {context.hostLabel}</Trans>
				</p>
				{checks.isPending && (
					<output className="flex items-center gap-2 text-xs">
						<LuLoaderCircle className="size-4 animate-spin" />
						<Trans>Checking workspaces and running sessions…</Trans>
					</output>
				)}
				{checks.isError && (
					<div role="alert" className="space-y-2 text-xs text-destructive">
						<p>
							<Trans>
								Could not check all workspaces. Check the host connection and
								try again before removing this project.
							</Trans>
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void checks.refetch()}
						>
							<Trans>Retry checks</Trans>
						</Button>
					</div>
				)}
				{latestUnsaved() && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>
							Save or close all unsaved files in this project before removing
							it.
						</Trans>
					</p>
				)}
				{checks.data?.rows.some((row) => row.blocked) && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>
							A workspace is protected. Resolve its protection before removing
							this project.
						</Trans>
					</p>
				)}
				{warnings.length > 0 && (
					<div className="space-y-2 rounded-md border p-3 text-xs">
						<p className="font-medium">
							<Trans>Uncommitted or unpushed work</Trans>
						</p>
						{warnings.map((row) => (
							<p key={row.id} className="break-all">
								{row.name}:{" "}
								{row.dirty && row.unpushed ? (
									<Trans>Uncommitted changes and unpushed commits</Trans>
								) : row.dirty ? (
									<Trans>Uncommitted changes</Trans>
								) : (
									<Trans>Unpushed commits</Trans>
								)}
							</p>
						))}
					</div>
				)}
				{hasRunning && (
					<div className="space-y-1 rounded-md border p-3 text-xs">
						{checks.data?.impact
							.filter(
								(row) =>
									row.runningTerminalCount > 0 || row.runningAgentCount > 0,
							)
							.map((row) => (
								<p key={row.workspaceId} className="break-all">
									<Trans>
										{row.name}: {row.runningTerminalCount} running terminals,{" "}
										{row.runningAgentCount} running agents
									</Trans>
								</p>
							))}
					</div>
				)}
				{needsAcknowledgment && (
					<label htmlFor={id} className="flex items-start gap-2 text-xs">
						<Checkbox
							id={id}
							disabled={pending}
							checked={acknowledged}
							onCheckedChange={(value) => setAcknowledged(value === true)}
						/>
						<Trans>
							I understand that running sessions will stop and teardown commands
							may affect files with unsaved work.
						</Trans>
					</label>
				)}
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="ghost" disabled={pending} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant="destructive"
						disabled={
							pending || blocked || (needsAcknowledgment && !acknowledged)
						}
						onClick={async () => {
							if (busy.current) return;
							if (latestUnsaved()) {
								setError(
									t({
										message:
											"Save or close all unsaved files in this project before removing it.",
									}),
								);
								return;
							}
							if (blocked) return;
							busy.current = true;
							setPending(true);
							setError(null);
							try {
								const previous = removalRiskFingerprint(checks.data);
								const fresh = await checks.refetch({ throwOnError: true });
								if (
									!fresh.data ||
									fresh.data.rows.some((row) => row.blocked) ||
									latestUnsaved()
								) {
									setError(
										t({
											message:
												"This project cannot be removed in its current state.",
										}),
									);
									return;
								}
								if (removalRiskFingerprint(fresh.data) !== previous) {
									setAcknowledged(false);
									setError(
										t({
											message:
												"Workspace or running session state changed. Review the updated checks and confirm again.",
										}),
									);
									return;
								}
								await onRemove(context, project);
								onClose();
							} catch {
								setError(
									t({
										message:
											"Could not finish removing the project. Refresh its status before trying again.",
									}),
								);
								await checks.refetch();
							} finally {
								busy.current = false;
								setPending(false);
							}
						}}
					>
						{pending ? <Trans>Removing…</Trans> : <Trans>Remove project</Trans>}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
