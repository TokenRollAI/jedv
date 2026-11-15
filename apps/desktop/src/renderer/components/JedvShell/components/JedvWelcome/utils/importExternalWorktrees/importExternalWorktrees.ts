import type { LocalClient } from "../../../../local-client";
import { redactProjectError } from "../../../JedvProjectActions/project-utils";
export type ExternalRepo = Awaited<
	ReturnType<LocalClient["project"]["detectExternalWorktrees"]["query"]>
>["repos"][number];
export type ImportItemState =
	| { state: "queued" | "importing" | "done" }
	| { state: "failed"; error: string };
export interface ExternalImportMessages {
	repoUnavailable: string;
	multipleProjects: string;
	importFailed: string;
}
export async function importExternalWorktrees({
	client,
	repos,
	selectedPaths,
	idForPath,
	onStatus,
	messages,
}: {
	client: LocalClient;
	repos: ExternalRepo[];
	selectedPaths: ReadonlySet<string>;
	idForPath(path: string): string;
	onStatus?(path: string, status: ImportItemState): void;
	messages: ExternalImportMessages;
}) {
	const projectIds: string[] = [];
	const workspaceIds: string[] = [];
	let firstSuccessfulProjectId: string | null = null;
	const results: Record<string, ImportItemState> = {};
	const status = (path: string, value: ImportItemState) => {
		results[path] = value;
		onStatus?.(path, value);
	};
	for (const repo of repos) {
		const worktrees = repo.worktrees.filter((row) =>
			selectedPaths.has(row.path),
		);
		if (worktrees.length === 0) continue;
		for (const row of worktrees) status(row.path, { state: "queued" });
		let projectId: string;
		try {
			const found = await client.project.findByPath.query({
				repoPath: repo.repoPath,
			});
			if (found.needsGitInit) throw new Error(messages.repoUnavailable);
			if (found.candidates.length > 1)
				throw new Error(messages.multipleProjects);
			projectId =
				found.candidates[0]?.id ??
				(
					await client.project.create.mutate({
						name: repo.name,
						mode: {
							kind: "importLocal",
							repoPath: repo.repoPath,
							initIfNeeded: false,
						},
					})
				).projectId;
			if (!projectIds.includes(projectId)) projectIds.push(projectId);
		} catch (failure) {
			const error = redactProjectError(
				failure instanceof Error ? failure.message : messages.importFailed,
			);
			for (const row of worktrees) status(row.path, { state: "failed", error });
			continue;
		}
		for (const row of worktrees) {
			status(row.path, { state: "importing" });
			try {
				const created = await client.workspaces.create.mutate({
					id: idForPath(row.path),
					projectId,
					checkout: "worktree",
					branch: row.branch,
					worktreePath: row.path,
					skipBranchPrefix: true,
					runSetup: false,
					trackSetupCompletion: true,
				});
				if (!workspaceIds.includes(created.workspace.id))
					workspaceIds.push(created.workspace.id);
				firstSuccessfulProjectId ??= projectId;
				status(row.path, { state: "done" });
			} catch (failure) {
				status(row.path, {
					state: "failed",
					error: redactProjectError(
						failure instanceof Error ? failure.message : messages.importFailed,
					),
				});
			}
		}
	}
	return { projectIds, workspaceIds, results, firstSuccessfulProjectId };
}
