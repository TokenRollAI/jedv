import { formatDate } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ProjectActionContext } from "../../JedvProjectActions";
import { redactProjectError } from "../../JedvProjectActions/project-utils";
import { type ProjectSettingsContext, settingsTarget } from "../types";
export interface DeletedProjectsPanelProps {
	context: ProjectSettingsContext;
	onChanged(context: ProjectActionContext): Promise<void>;
}
export function DeletedProjectsPanel(props: DeletedProjectsPanelProps) {
	const { t } = useLingui();
	const [context] = useState(() => settingsTarget(props.context));
	const query = useQuery({
		queryKey: ["jedv", context.hostUrl, "deleted-projects"],
		queryFn: () => context.client.project.listDeleted.query(),
		retry: false,
	});
	const [pending, setPending] = useState<string | null>(null);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmation, setConfirmation] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [typed, setTyped] = useState("");
	const run = async (id: string, purge = false) => {
		if (busy.current) return;
		busy.current = true;
		setPending(id);
		setError(null);
		try {
			if (purge) await context.client.project.purge.mutate({ projectId: id });
			else await context.client.project.restore.mutate({ projectId: id });
			await query.refetch({ throwOnError: true });
			await props.onChanged(context);
			setConfirmation(null);
			setTyped("");
		} catch (failure) {
			setError(
				redactProjectError(
					failure instanceof Error
						? failure.message
						: t({
								message:
									"Could not update the removed project. Check its status before retrying.",
							}),
				),
			);
		} finally {
			busy.current = false;
			setPending(null);
		}
	};
	return (
		<section className="space-y-4 p-6">
			<header>
				<h3 className="text-sm font-medium">
					<Trans>Recently removed projects</Trans>
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					<Trans>
						Restoring brings back available workspace records and existing
						directories. It does not restart terminated sessions or recover
						files changed by teardown.
					</Trans>
				</p>
			</header>
			<p className="break-all text-xs text-muted-foreground">
				<Trans>Target host: {context.hostLabel}</Trans>
			</p>
			{query.isPending ? (
				<output className="text-xs">
					<Trans>Loading removed projects…</Trans>
				</output>
			) : query.isError ? (
				<div role="alert" className="text-xs">
					<Trans>Could not read removed projects from this host.</Trans>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void query.refetch()}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			) : query.data?.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					<Trans>No removed projects</Trans>
				</p>
			) : (
				<div className="divide-y rounded border">
					{query.data?.map((project) => (
						<div
							key={project.id}
							className="flex flex-wrap items-center gap-3 p-3"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{project.name}</p>
								<p className="break-all font-mono text-[11px] text-muted-foreground">
									{project.repoPath}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									<Trans>
										{project.workspaceCount} workspace records · retained until{" "}
										{formatDate(project.purgeAt)}
									</Trans>
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								disabled={pending !== null}
								onClick={() => void run(project.id)}
							>
								<Trans>Restore</Trans>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive"
								disabled={pending !== null}
								onClick={() => {
									setConfirmation({ id: project.id, name: project.name });
									setTyped("");
								}}
							>
								<Trans>Delete permanently…</Trans>
							</Button>
						</div>
					))}
				</div>
			)}
			{error && (
				<p role="alert" className="break-words text-xs text-destructive">
					{error}
				</p>
			)}
			{confirmation && (
				<Dialog
					open
					modal
					onOpenChange={(open) => {
						if (!open && !busy.current) setConfirmation(null);
					}}
				>
					<DialogContent showCloseButton={!pending}>
						<DialogHeader>
							<DialogTitle>
								<Trans>Delete project permanently?</Trans>
							</DialogTitle>
							<DialogDescription>
								<Trans>
									This permanently deletes the removed project and workspace
									records and attempts to remove their clean worktree
									directories. Dirty worktree directories may remain untracked.
									The main repository directory is kept. This cannot be undone.
								</Trans>
							</DialogDescription>
						</DialogHeader>
						<p className="break-all text-sm font-medium">{confirmation.name}</p>
						<Input
							aria-label={t({ message: "Type project name to confirm" })}
							value={typed}
							onChange={(event) => setTyped(event.target.value)}
							disabled={pending !== null}
						/>
						<DialogFooter>
							<Button
								variant="ghost"
								disabled={pending !== null}
								onClick={() => setConfirmation(null)}
							>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								variant="destructive"
								disabled={pending !== null || typed !== confirmation.name}
								onClick={() => void run(confirmation.id, true)}
							>
								{pending ? (
									<Trans>Deleting…</Trans>
								) : (
									<Trans>Delete permanently</Trans>
								)}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</section>
	);
}
