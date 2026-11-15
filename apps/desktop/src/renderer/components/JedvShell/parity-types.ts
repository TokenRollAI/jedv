import type { LocalClient, LocalConnection } from "./local-client";
import type { Project, Workspace } from "./types";

export type JedvSurface =
	| "terminal"
	| "board"
	| "automations"
	| "butler"
	| "teamwork"
	| "create-team"
	| "pull-requests"
	| "usage"
	| "settings"
	| "files";

export type JedvSettingsSection =
	| "system-agents"
	| "appearance"
	| "projects"
	| "permissions"
	| "notifications"
	| "usage"
	| "connection"
	| "general"
	| "keyboard"
	| "git"
	| "agents"
	| "terminal"
	| "files";

export interface JedvParityViewContext {
	client: LocalClient;
	hostUrl: string;
	logicalHostId?: string;
	remote: LocalConnection | null;
	projects: Project[];
	workspaces: Workspace[];
	onOpenWorkspace(
		workspaceId: string,
		terminalId?: string | null,
	): Promise<void>;
	onOpenCreateWorkspace(projectId?: string | null): void;
	onOpenPrivateConnection(): void;
	onSelectLocalHost(): Promise<void>;
}
