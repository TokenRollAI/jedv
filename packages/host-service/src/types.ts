import type { ChatRuntime } from "@jedv/chat-runtime";
import type { Octokit } from "@octokit/rest";
import type { LocalAutomations } from "./automations/automations";
import type { ClosedMidTurnChat } from "./chat-v3/closedMidTurn";
import type { HostDb } from "./db";
import type { EventBus } from "./events";
import type { WorkspaceFilesystemManager } from "./runtime/filesystem";
import type { GitCredentialProvider, GitFactory } from "./runtime/git";
import type { PullRequestRuntimeManager } from "./runtime/pull-requests";
import type { TerminalAgentStore } from "./terminal-agents";
import type { ExecGh } from "./trpc/router/workspace-creation/utils/exec-gh";

export interface HostServiceRuntime {
	automations?: LocalAutomations;
	automationsError?: string;
	filesystem: WorkspaceFilesystemManager;
	pullRequests: PullRequestRuntimeManager;
	chat?: () => ChatRuntime;
	closeChats?: (scopeId: string) => Promise<void>;
	closedMidTurn?: {
		list(): ClosedMidTurnChat[];
		resume(): Promise<number>;
		keepPaused(): void;
	};
}

export interface HostServiceContext {
	git: GitFactory;
	credentials: GitCredentialProvider;
	github: () => Promise<Octokit>;
	execGh: ExecGh;
	db: HostDb;
	runtime: HostServiceRuntime;
	eventBus: EventBus;
	terminalAgentStore: TerminalAgentStore;
	organizationId: string;
	isAuthenticated: boolean;
	clientMachineId?: string;
	/** Optional creator identity supplied by an authenticated local client. */
	userId?: string;
	/** Present only when a desktop app spawned this host (has a desktop window). */
	desktopBridge?: DesktopBridgeConfig;
}

export interface DesktopBridgeConfig {
	url: string;
	secret: string;
}
