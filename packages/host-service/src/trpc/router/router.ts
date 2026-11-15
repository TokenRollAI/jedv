import { router } from "../index";
import { agentToolingRouter } from "./agent-tooling";
import { agentsRouter } from "./agents";
import { aiSettingsRouter } from "./ai-settings";
import { attachmentsRouter } from "./attachments";
import { automationsRouter } from "./automations";
import { butlerRouter } from "./butler";
import { configRouter } from "./config";
import { declarativeSlotsRouter } from "./declarative-slots";
import { filesystemRouter } from "./filesystem";
import { gitRouter } from "./git";
import { githubRouter } from "./github";
import { healthRouter } from "./health";
import { hostRouter } from "./host";
import { linkPreviewRouter } from "./link-preview";
import { mailRouter } from "./mail";
import { memoryRouter } from "./memory";
import { mobileAuthRouter } from "./mobile-auth";
import { notificationsRouter } from "./notifications";
import { panesRouter } from "./panes";
import { peersRouter } from "./peers";
import { portsRouter } from "./ports";
import { projectRouter } from "./project";
import { pullRequestsRouter } from "./pull-requests";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { tagFoldersRouter } from "./tag-folders";
import { teamRouter } from "./team";
import { terminalRouter } from "./terminal";
import { terminalAgentsRouter } from "./terminal-agents";
import { usageRouter } from "./usage";
import { watchdogRouter } from "./watchdog";
import { workspaceRouter } from "./workspace";
import { workspaceCleanupRouter } from "./workspace-cleanup";
import { workspaceCreationRouter } from "./workspace-creation";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	peers: peersRouter,
	mobileAuth: mobileAuthRouter,
	declarativeSlots: declarativeSlotsRouter,
	butler: butlerRouter,
	memory: memoryRouter,
	aiSettings: aiSettingsRouter,
	watchdog: watchdogRouter,
	team: teamRouter,
	mail: mailRouter,
	automations: automationsRouter,
	agents: agentsRouter,
	sessions: sessionsRouter,
	agentTooling: agentToolingRouter,
	attachments: attachmentsRouter,

	health: healthRouter,
	host: hostRouter,
	config: configRouter,
	filesystem: filesystemRouter,
	git: gitRouter,
	github: githubRouter,
	linkPreview: linkPreviewRouter,
	notifications: notificationsRouter,
	pullRequests: pullRequestsRouter,
	project: projectRouter,
	tagFolders: tagFoldersRouter,
	panes: panesRouter,
	ports: portsRouter,
	settings: settingsRouter,
	terminal: terminalRouter,
	terminalAgents: terminalAgentsRouter,
	usage: usageRouter,
	workspace: workspaceRouter,
	workspaces: workspacesRouter,
	workspaceCleanup: workspaceCleanupRouter,
	workspaceCreation: workspaceCreationRouter,
});

export type AppRouter = typeof appRouter;
