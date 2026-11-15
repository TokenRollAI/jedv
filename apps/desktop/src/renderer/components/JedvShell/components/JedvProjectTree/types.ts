import type { WorkspaceSortMode } from "../../project-tree";
import type { NativeProvider, Project, Workspace } from "../../types";
import type { ActiveBinding } from "../ActiveWorkspaceSwitcher/active-workspaces";
import type { ProjectActionContext } from "../JedvProjectActions";
export interface ProjectTreeNavigation {
	collapsedProjects: readonly string[];
	collapsedGroups: readonly string[];
	setCollapsedGroups(keys: string[]): void;
	workspaceSortMode?: WorkspaceSortMode;
	setCollapsedProjects(ids: string[]): void;
	setWorkspaceSortMode(mode: WorkspaceSortMode): void;
}
export type ProjectTreeTarget = { kind: "project" | "workspace"; id: string };
export interface JedvProjectTreeProps {
	context: ProjectActionContext;
	projects: Project[];
	workspaces: Workspace[];
	bindings: ActiveBinding[];
	activeWorkspaceId: string | null;
	onShortcutOrder?(ids: string[]): void;
	shortcutOrder?: readonly string[];
	onOpenPullRequest?(
		context: ProjectActionContext,
		target: import("../JedvPullRequestsView/types").PullRequestTarget,
	): void;
	onOpenPort?(
		context: ProjectActionContext,
		workspaceId: string,
		url: string,
	): Promise<void>;
	navigation: ProjectTreeNavigation;
	filter: string;
	disabled?: boolean;
	onOpenWorkspace(
		context: ProjectActionContext,
		workspaceId: string,
		terminalId?: string,
	): Promise<unknown>;
	onCreateTerminal(
		context: ProjectActionContext,
		workspaceId: string,
	): Promise<unknown>;
	onLaunch(
		context: ProjectActionContext,
		provider: NativeProvider,
		workspaceId: string,
	): Promise<unknown>;
	onRename(
		context: ProjectActionContext,
		target: ProjectTreeTarget,
		name: string,
	): Promise<void>;
	onDeleteWorkspace(context: ProjectActionContext, workspace: Workspace): void;
	onCopy(context: ProjectActionContext, value: string): unknown;
	onOpenFolder?(context: ProjectActionContext, path: string): unknown;
	onProjectAction(
		context: ProjectActionContext,
		project: Project,
		mode: "new" | "local" | "import",
	): void;
	onAppearance?(context: ProjectActionContext, project: Project): void;
	onRemoveProject(context: ProjectActionContext, project: Project): void;
	onProjectSettings?(context: ProjectActionContext, project: Project): void;
	onChanged?(context: ProjectActionContext): Promise<void>;
}
