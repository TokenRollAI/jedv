import type { AgentIslandEntry } from "shared/types/agent-island";
import type { LocalClient } from "../../local-client";
import type { JedvParityViewContext } from "../../parity-types";
export type ActivityAgentSource =
	| { status: "ready"; entries: readonly AgentIslandEntry[] }
	| { status: "unavailable"; reason: string };
export type ActivityPullRequest = Awaited<
	ReturnType<LocalClient["pullRequests"]["historyByWorkspaces"]["query"]>
>["workspaces"][number]["pullRequests"][number];
export interface ActivityChatSession {
	sessionId: string;
	harness: string;
	title: string | null;
	live: boolean;
	status?: string;
	harnessSessionId?: string | null;
}
export interface JedvWorkspaceActivityProps {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	workspaceName: string;
	compact?: boolean;
	gitEnabled?: boolean;
	pullRequestsEnabled?: boolean;
	isChangesOpen?: boolean;
	shipContext?: JedvParityViewContext;
	onOpenFile?(path: string, pinned?: boolean): void;
	getHasUnsavedFiles?(): boolean;
	dockTarget?: HTMLElement | null;
	dockFits?: boolean;
	dockHidden?: boolean;
	onDockHiddenChange?(hidden: boolean): void;
	hostLabel?: string;
	getWsToken?: () => string | null;
	attachedTerminalIds?: readonly string[];
	agentSource: ActivityAgentSource;
	chatSessions?: readonly ActivityChatSession[];
	showChangesPill?: boolean;
	onOpenChanges(): void | Promise<void>;
	onOpenPullRequests(pr?: ActivityPullRequest): void | Promise<void>;
	onOpenTerminal(id: string): void | Promise<void>;
	onOpenAgent?(entry: AgentIslandEntry): void | Promise<void>;
	onOpenChat?(chat: ActivityChatSession): void | Promise<void>;
}
