import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { LuFolderSearch, LuLoaderCircle } from "react-icons/lu";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import { redactProjectError } from "../../../JedvProjectActions/project-utils";
import type { WelcomeImportResult } from "../../types";
import { ImportFromOtherToolsDialog } from "./components/ImportFromOtherToolsDialog";
import type { ExternalWorktreeRepo } from "./constants";

export function ImportFromOtherTools({
	context,
	onImported,
}: {
	context: ProjectActionContext | null;
	onImported(result: WelcomeImportResult): Promise<void>;
}) {
	const { t } = useLingui();
	const [snapshot, setSnapshot] = useState<{
		context: ProjectActionContext;
		repos: ExternalWorktreeRepo[];
	} | null>(null);
	const detection = useMutation({
		mutationFn: async (target: ProjectActionContext) => ({
			context: target,
			repos: (await target.client.project.detectExternalWorktrees.query())
				.repos,
		}),
		onSuccess: (result) => {
			if (result.repos.length > 0) setSnapshot(result);
		},
	});
	return (
		<div className="flex flex-col items-center gap-2">
			<Button
				className="h-auto max-w-full whitespace-normal text-center text-xs"
				variant="ghost"
				disabled={!context || detection.isPending}
				onClick={() => {
					if (context) detection.mutate({ ...context });
				}}
			>
				{detection.isPending ? (
					<LuLoaderCircle className="size-4 shrink-0 animate-spin" />
				) : (
					<LuFolderSearch className="size-4 shrink-0" />
				)}
				<Trans>Detect workspaces from other tools</Trans>
			</Button>
			{detection.isError && (
				<p role="alert" className="break-words text-xs text-destructive">
					{redactProjectError(
						detection.error instanceof Error
							? detection.error.message
							: t({ message: "Could not detect workspaces" }),
					)}
				</p>
			)}
			{detection.isSuccess && detection.data.repos.length === 0 && (
				<p className="text-center text-xs text-muted-foreground">
					<Trans>
						No importable worktrees found on this host. You can open a project
						and import its worktrees instead.
					</Trans>
				</p>
			)}
			{snapshot && (
				<ImportFromOtherToolsDialog
					context={snapshot.context}
					repos={snapshot.repos}
					onClose={() => setSnapshot(null)}
					onImported={onImported}
				/>
			)}
		</div>
	);
}
