export interface LocalProjectActions {
	findProject(input: { repoPath: string }): Promise<{
		needsGitInit?: boolean;
		candidates: { id: string; name: string }[];
	}>;
	importProject(input: {
		name: string;
		mode: { kind: "importLocal"; repoPath: string; initIfNeeded: boolean };
	}): Promise<{ projectId: string }>;
	listWorkspaces(): Promise<
		{ id: string; projectId: string | null; type: string }[]
	>;
	createWorkspace(input: {
		projectId: string;
		checkout: "local";
		runSetup: false;
	}): Promise<{ workspace: { id: string } }>;
	requestGitInit?(repoPath: string): Promise<boolean>;
}
export class LocalProjectError extends Error {
	constructor(
		public readonly reason:
			| "empty-path"
			| "multiple-projects"
			| "checkout-failed",
		public readonly projectId?: string,
		options?: ErrorOptions,
	) {
		super(reason, options);
	}
}
export async function ensureLocalCheckout(
	actions: Pick<LocalProjectActions, "listWorkspaces" | "createWorkspace">,
	projectId: string,
): Promise<string> {
	try {
		const existing = (await actions.listWorkspaces()).find(
			(item) => item.projectId === projectId && item.type === "local",
		);
		if (existing) return existing.id;
		return (
			await actions.createWorkspace({
				projectId,
				checkout: "local",
				runSetup: false,
			})
		).workspace.id;
	} catch (cause) {
		throw new LocalProjectError("checkout-failed", projectId, { cause });
	}
}
export async function openLocalProject(
	actions: LocalProjectActions,
	repoPath: string,
): Promise<string | null> {
	const path = repoPath.trim();
	if (!path) throw new LocalProjectError("empty-path");
	const found = await actions.findProject({ repoPath: path });
	if (found.candidates.length > 1)
		throw new LocalProjectError("multiple-projects");
	let projectId = found.candidates[0]?.id;
	if (!projectId) {
		const initIfNeeded = found.needsGitInit === true;
		if (initIfNeeded && !(await actions.requestGitInit?.(path))) return null;
		const result = await actions.importProject({
			name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
			mode: { kind: "importLocal", repoPath: path, initIfNeeded },
		});
		projectId = result.projectId;
	}
	return ensureLocalCheckout(actions, projectId);
}
