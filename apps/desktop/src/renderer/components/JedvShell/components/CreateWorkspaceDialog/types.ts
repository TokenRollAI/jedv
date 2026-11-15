import type { LocalClient } from "../../local-client";
import type { ProjectActionContext } from "../JedvProjectActions";
export type BranchRow = Awaited<
	ReturnType<LocalClient["workspaceCreation"]["searchBranches"]["query"]>
>["items"][number];
export type BranchFilter = "all" | "worktree";
export type WorkspaceCreateMode = "new" | "local" | "branch" | "pr" | "import";
export interface CreateWorkspaceInput {
	projectId: string;
	name?: string;
	checkout?: "local" | "worktree";
	branch?: string;
	baseBranch?: string;
	pr?: number;
	worktreePath?: string;
	runSetup: boolean;
	trackSetupCompletion?: boolean;
	id?: string;
	skipBranchPrefix?: boolean;
	tags?: string[];
}
export interface CreatedWorkspaceResult {
	context: ProjectActionContext;
	workspaceId: string;
	terminalId?: string;
}
