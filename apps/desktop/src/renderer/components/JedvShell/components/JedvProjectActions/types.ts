import type { LocalClient } from "../../local-client";

export type ProjectActionKind =
	| "open"
	| "clone"
	| "empty"
	| "template"
	| "folder";
export interface ProjectActionContext {
	client: LocalClient;
	hostUrl: string;
	hostLabel: string;
	isRemote: boolean;
}
export interface ProjectOpenedResult {
	context: ProjectActionContext;
	projectId: string;
	workspaceId: string;
}
export interface JedvProjectActionsHandle {
	open(kind: ProjectActionKind, path?: string): void;
}
export interface JedvProjectActionsProps {
	context: ProjectActionContext | null;
	onRefresh(context: ProjectActionContext): Promise<void>;
	onOpened(result: ProjectOpenedResult): Promise<void> | void;
}
export interface ProjectDraft {
	name: string;
	parentDir: string;
	url: string;
	repoPath: string;
	templateId: string | null;
	nameTouched: boolean;
}
