import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Project } from "../../types";
import {
	IconUploadField,
	type ProjectActionContext,
	resolveProjectIconUrl,
} from "../JedvProjectActions";
import { BranchPrefixSection } from "./components/BranchPrefixSection";
import { NameSection } from "./components/NameSection";
import { NamingInstructionsSection } from "./components/NamingInstructionsSection";
import { ProjectLocationSection } from "./components/ProjectLocationSection";
import { RepositorySection } from "./components/RepositorySection";
import { SparseCheckoutSection } from "./components/SparseCheckoutSection";
import { WorkspaceConfigEditor } from "./components/WorkspaceConfigEditor";
import { WorktreeLocationSection } from "./components/WorktreeLocationSection/WorktreeLocationSection";
import { type ProjectSettingsContext, settingsTarget } from "./types";
export interface ProjectSettingsProps {
	context: ProjectSettingsContext;
	projectId: string;
	onChanged(context: ProjectActionContext): Promise<void>;
	onRequestRemove?(project: Project, context: ProjectActionContext): void;
}
export function ProjectSettings(props: ProjectSettingsProps) {
	const [target] = useState(() => ({
		context: settingsTarget(props.context),
		projectId: props.projectId,
	}));
	const { context, projectId } = target;
	const project = useQuery({
		queryKey: ["jedv", context.hostUrl, "project-settings", projectId],
		queryFn: () => context.client.project.get.query({ projectId }),
		retry: false,
	});
	const refresh = async () => {
		await project.refetch({ throwOnError: true });
		await props.onChanged(context);
	};
	if (project.isPending)
		return (
			<output className="p-6 text-sm">
				<Trans>Loading project settings…</Trans>
			</output>
		);
	if (project.isError)
		return (
			<div role="alert" className="space-y-2 p-6 text-sm">
				<p>
					<Trans>Could not load project settings from the target host.</Trans>
				</p>
				<Button variant="outline" onClick={() => void project.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	const value = project.data;
	if (!value)
		return (
			<p className="p-6 text-sm text-muted-foreground">
				<Trans>This project is not set up on the target host.</Trans>
			</p>
		);
	return (
		<div className="mx-auto w-full max-w-4xl space-y-8 p-6 select-text">
			<header>
				<h2 className="text-lg font-semibold">{value.name}</h2>
				<p className="mt-1 break-all text-xs text-muted-foreground">
					<Trans>Target host: {context.hostLabel}</Trans>
				</p>
			</header>
			<section className="space-y-4">
				<h3 className="text-sm font-medium">
					<Trans>General</Trans>
				</h3>
				<label htmlFor="project-name" className="block space-y-2">
					<span className="text-xs text-muted-foreground">
						<Trans>Project name</Trans>
					</span>
					<NameSection
						client={context.client}
						hostUrl={context.hostUrl}
						projectId={projectId}
						currentName={value.name}
						canRename
						onRenamed={() => void refresh()}
					/>
				</label>
				<div className="flex items-center gap-3">
					<IconUploadField
						client={context.client}
						projectId={projectId}
						projectName={value.name}
						iconUrl={resolveProjectIconUrl(value)}
						hasCustomIcon={!!value.icon && value.icon !== "none"}
						isIconRemoved={value.icon === "none"}
						color={value.color}
						onUpdated={refresh}
					/>
					<span className="text-xs text-muted-foreground">
						<Trans>Project icon and color</Trans>
					</span>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">
						<Trans>Repository</Trans>
					</p>
					<RepositorySection repoUrl={value.repoUrl} />
				</div>
			</section>
			<section className="space-y-4 border-t pt-6">
				<h3 className="text-sm font-medium">
					<Trans>Branches & naming</Trans>
				</h3>
				<BranchPrefixSection
					client={context.client}
					hostUrl={context.hostUrl}
					projectId={projectId}
					mode={value.branchPrefixMode ?? null}
					customPrefix={value.branchPrefixCustom ?? null}
					onChanged={() => void refresh()}
				/>
				<NamingInstructionsSection
					client={context.client}
					hostUrl={context.hostUrl}
					projectId={projectId}
					instructions={value.namingInstructions ?? null}
					onChanged={() => void refresh()}
				/>
			</section>
			<section className="space-y-4 border-t pt-6">
				<h3 className="text-sm font-medium">
					<Trans>Location & checkout</Trans>
				</h3>
				<ProjectLocationSection
					context={context}
					projectId={projectId}
					currentPath={value.repoPath}
					repoUrl={value.repoUrl}
					onChanged={refresh}
				/>
				{!value.repoPathExists && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>
							The repository directory is missing on this host. Open the
							repository at its current path to set it up again.
						</Trans>
					</p>
				)}
				<WorktreeLocationSection
					context={context}
					projectId={projectId}
					currentPath={value.worktreeBaseDir}
					onChanged={refresh}
				/>
				<div className="space-y-2">
					<h4 className="text-xs font-medium">
						<Trans>Sparse checkout</Trans>
					</h4>
					<p className="text-xs text-muted-foreground">
						<Trans>
							Folders to check out into new worktrees, one per line, relative to
							the repo root. Root files are always included. Empty checks out
							everything.
						</Trans>
					</p>
					<SparseCheckoutSection
						client={context.client}
						hostUrl={context.hostUrl}
						projectId={projectId}
						paths={value.sparseCheckoutPaths ?? []}
						onChanged={() => void refresh()}
					/>
				</div>
			</section>
			<section className="space-y-4 border-t pt-6">
				<h3 className="text-sm font-medium">
					<Trans>Workspace configuration</Trans>
				</h3>
				<p className="text-xs text-muted-foreground">
					<Trans>
						Edit shared setup, run and teardown commands, or personal overrides.
						Saving does not execute commands.
					</Trans>
				</p>
				<WorkspaceConfigEditor
					client={context.client}
					hostUrl={context.hostUrl}
					projectId={projectId}
				/>
			</section>
			{props.onRequestRemove && (
				<section className="space-y-3 border-t pt-6">
					<h3 className="text-sm font-medium">
						<Trans>Danger zone</Trans>
					</h3>
					<Button
						variant="destructive"
						onClick={async () => {
							const projects = await context.client.project.list.query();
							const row = projects.find((item) => item.id === projectId);
							if (row) props.onRequestRemove?.(row, context);
						}}
					>
						<Trans>Remove from Jedv…</Trans>
					</Button>
				</section>
			)}
		</div>
	);
}
