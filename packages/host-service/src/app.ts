import { createNodeWebSocket } from "@hono/node-ws";
import { trpcServer } from "@hono/trpc-server";
import { resolveAppHomeDir } from "@jedv/agent-setup/paths";
import { JEDV_USER_ID_HEADER } from "@jedv/shared/host-routing";
import { Octokit } from "@octokit/rest";
import { TRPCError } from "@trpc/server";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { LocalAutomations } from "./automations/automations";
import { createAutomationExecutor } from "./automations/execute";
import { registerButlerHttp } from "./butler/http";
import { createButler } from "./butler/runtime";
import type { ButlerService } from "./butler/service";
import {
	createChatAgentBridge,
	createChatV3Mount,
	registerChatV3Routes,
} from "./chat-v3";
import { createDb, type HostDb } from "./db";
import { EventBus, GitWatcher, registerEventBusRoute } from "./events";
import { mergeOpenApiPaths, type OpenApiPaths } from "./http/openapi";
import {
	createHostMemoryRuntime,
	type HostMemoryOptions,
} from "./memory/host-runtime";
import { registerMemoryHttp } from "./memory/http";
import type { MemoryRuntime } from "./memory/runtime";
import { mobilePublicAssets } from "./mobile/assets";
import { registerMobileHttp } from "./mobile/http";
import { MobileAuthService } from "./mobile/service";
import { registerPeerIngest } from "./peers/ingest-http";
import type { PeerRuntimeTestHooks } from "./peers/outbox-forwarder";
import { registerForwardMuxRoute } from "./ports/forward-mux-route";
import { portManager } from "./ports/port-manager";
import type { HostAuthProvider } from "./providers/host-auth";
import { WorkspaceFilesystemManager } from "./runtime/filesystem";
import type { GitCredentialProvider } from "./runtime/git";
import { createGitEnvResolver, createGitFactory } from "./runtime/git";
import { runProjectBackfill } from "./runtime/project-backfill";
import { PullRequestRuntimeManager } from "./runtime/pull-requests";
import { DeclarativeSlotService } from "./slots/service";
import { registerTeamworkHttp } from "./teams/http";
import { TeamworkRuntime } from "./teams/runtime";
import { registerWorkspaceTerminalRoute } from "./terminal/terminal";
import {
	SqliteTerminalAgentBindingPersistence,
	TerminalAgentStore,
} from "./terminal-agents";
import { appRouter } from "./trpc/router";
import {
	ATTACHMENT_SWEEP_INTERVAL_MS,
	sweepAttachmentStore,
} from "./trpc/router/attachments/sweep";
import { gitStatusStore } from "./trpc/router/git/utils/git-status-store";
import {
	resumeCrashedAgentSessions,
	resumeSessionDepsFor,
} from "./trpc/router/terminal-agents/terminal-agents";
import { recoverWorkspaceSetupTerminals } from "./trpc/router/workspace-creation/shared/workspace-setup";
import {
	execGh as defaultExecGh,
	type ExecGh,
} from "./trpc/router/workspace-creation/utils/exec-gh";
import type { DesktopBridgeConfig, HostServiceContext } from "./types";
import { getHostWorkerPool } from "./workers/host-worker-pool";
import { gitWorkspaceRefsTask } from "./workers/tasks/git";
import { disposeUsageWorkerPool } from "./workers/usage-worker-pool";
import { disposeWorkspaceTitleJobs } from "./workspaces/workspace-title-jobs";

export interface CreateAppOptions {
	config: {
		organizationId: string;
		dbPath: string;
		migrationsFolder: string;
		allowedOrigins: string | string[];
		/** Loopback surface for driving desktop browser panes; desktop-only. */
		desktopBridge?: DesktopBridgeConfig;
	};
	providers: {
		hostAuth: HostAuthProvider;
		credentials: GitCredentialProvider;
	};
	/**
	 * Test-harness override hooks. Production never sets these — `createApp`
	 * builds each subsystem itself when omitted. `db` is overridden so tests
	 * can swap in `bun:sqlite` (better-sqlite3 isn't loadable under Bun;
	 * prod uses it on bundled Node). `github` is overridden to
	 * keep tests off the network.
	 */
	db?: HostDb;
	github?: () => Promise<Octokit>;
	execGh?: ExecGh;
	memory?: HostMemoryOptions;
	peers?: PeerRuntimeTestHooks & { home?: string };
}

export interface CreateAppResult {
	app: Hono;
	injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
	db: HostDb;
	eventBus: EventBus;
	resumeCrashedAgents: () => Promise<void>;
	recoverWorkspaceSetupTerminals: () => Promise<void>;
	recordUnfinishedChats: () => void;
	readLinkedPullRequests: () => Promise<
		{ repository: string; number: number; linkedAt: number }[]
	>;
	onPullRequestLinked: (listener: () => void) => () => void;
	terminalAgentStore: TerminalAgentStore;
	memoryRuntime: MemoryRuntime;
	butlerService: ButlerService;
	teamworkRuntime: TeamworkRuntime;
	mobileAuthService: MobileAuthService;
	slotService: DeclarativeSlotService;
	dispose: () => Promise<void>;
}

export function createApp(options: CreateAppOptions): CreateAppResult {
	const { config, providers } = options;

	const db = options.db ?? createDb(config.dbPath, config.migrationsFolder);
	const git = createGitFactory(providers.credentials);
	const github =
		options.github ??
		(async () => {
			const token = await providers.credentials.getToken("github.com");
			if (!token) {
				// Expected precondition failure (user has no GitHub auth), not an
				// internal error — every procedure calling ctx.github() inherits
				// this classification.
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: providers.credentials.credentialRemedy(
						"github.com",
						"missing",
					),
					cause: { kind: "NO_GITHUB_TOKEN" },
				});
			}
			return new Octokit({ auth: token });
		});
	const execGh: ExecGh = options.execGh ?? defaultExecGh;

	let hostMemory: ReturnType<typeof createHostMemoryRuntime> | undefined;
	const filesystem = new WorkspaceFilesystemManager({ db });
	// GitWatcher is the single source of truth for `.git/` and worktree fs
	// activity per workspace. Both EventBus (broadcasts to clients) and the
	// pull-requests runtime (event-driven branch sync) subscribe to it.
	const gitWatcher = new GitWatcher(db, filesystem, (workspaceId, watched) => {
		if (watched) gitStatusStore.attach(workspaceId);
		else gitStatusStore.drop(workspaceId);
	});
	gitWatcher.onChanged((event) => {
		gitStatusStore.recordChange(event.workspaceId, event.paths);
		hostMemory?.recordGitActivity(event.workspaceId);
	});
	gitWatcher.start();
	// Per-workspace branch/HEAD/upstream reads run in the worker pool: the
	// PR-sync loop fires them for every workspace on each watcher event and
	// 5-min sweep, which would otherwise spawn+drain git on the event loop.
	const resolveGitEnv = createGitEnvResolver(providers.credentials);
	const pullRequestRuntime = new PullRequestRuntimeManager({
		db,
		execGh,
		git,
		github,
		gitWatcher,
		readWorkspaceRefs: async (worktreePath) => {
			const gitEnv = await resolveGitEnv(worktreePath);
			return getHostWorkerPool().run(
				gitWorkspaceRefsTask,
				{ worktreePath, gitEnv },
				{
					timeoutMs: 15_000,
					strategy: "coalesce",
					dedupeKey: `${worktreePath}:workspace-refs`,
				},
			);
		},
	});
	pullRequestRuntime.start();

	const app = new Hono();
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

	app.use(
		"*",
		cors({
			origin: config.allowedOrigins,
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"trpc-accept",
				"x-jedv-client-machine-id",
				JEDV_USER_ID_HEADER,
			],
		}),
	);

	const eventBus = new EventBus({ db, filesystem, gitWatcher });
	eventBus.start();
	// Post-construction wiring (pullRequestRuntime is built before the
	// EventBus): newly created workspaces get their first branch/upstream sync
	// + PR link immediately instead of waiting for the 5-min safety net.
	pullRequestRuntime.subscribeToWorkspaceEvents(eventBus);

	const terminalAgentPersistence = new SqliteTerminalAgentBindingPersistence(
		db,
	);
	// Hygiene only — reads hide defunct bindings via the session-liveness
	// join regardless, so a failure here must not block startup.
	try {
		terminalAgentPersistence.sweepDefunct();
	} catch (error) {
		console.warn(
			"[terminal-agents] failed to sweep defunct binding rows",
			error,
		);
	}
	const terminalAgentStore = new TerminalAgentStore(terminalAgentPersistence);

	const runtime = {
		memory: undefined as MemoryRuntime | undefined,
		butler: undefined as ButlerService | undefined,
		mobileAuth: undefined as MobileAuthService | undefined,
		slots: undefined as DeclarativeSlotService | undefined,
		teamwork: undefined as TeamworkRuntime | undefined,
		automations: undefined as LocalAutomations | undefined,
		automationsError: undefined as string | undefined,
		filesystem,
		pullRequests: pullRequestRuntime,
		chat: () => chatV3.runtime(),
		closeChats: (scopeId: string) => chatV3.closeScope(scopeId),
		closedMidTurn: {
			list: () => chatV3.closedMidTurn(),
			resume: () => chatV3.resumeClosedMidTurn(),
			keepPaused: () => chatV3.keepClosedMidTurnPaused(),
		},
	};

	const chatAgentContext: HostServiceContext = {
		git,
		credentials: providers.credentials,
		github,
		execGh,

		db,
		runtime,
		eventBus,
		terminalAgentStore,
		organizationId: config.organizationId,
		isAuthenticated: true,
		desktopBridge: config.desktopBridge,
	};
	hostMemory = createHostMemoryRuntime(chatAgentContext, options.memory);
	runtime.memory = hostMemory.runtime;
	runtime.memory.start();
	const removeMemoryWorkspaceListener = eventBus.onWorkspaceChanged((event) => {
		if (event.eventType === "deleted")
			hostMemory?.forgetWorkspace(event.workspaceId);
	});
	const chatV3 = createChatV3Mount({
		db,

		dbPath: config.dbPath,
		agents: createChatAgentBridge(chatAgentContext),
		onSessionChanged: ({ scopeId, occurredAt }) =>
			eventBus.broadcastChatSessionsChanged({
				workspaceId: scopeId,
				occurredAt,
			}),
	});
	try {
		runtime.automations = new LocalAutomations({
			home: resolveAppHomeDir(),
			execute: createAutomationExecutor(chatAgentContext),
		});
		runtime.automations.start();
	} catch (error) {
		runtime.automationsError =
			error instanceof Error ? error.message : String(error);
		console.error("[host-service] automations unavailable", error);
	}
	try {
		chatV3.resumeAfterUpdate();
	} catch (error) {
		console.warn("[host-service] chat resume after update failed:", error);
	}

	const runAttachmentSweep = () =>
		sweepAttachmentStore().catch((err) => {
			console.warn("[host-service] attachment sweep failed:", err);
		});
	const attachmentSweepTimer = setInterval(
		() => void runAttachmentSweep(),
		ATTACHMENT_SWEEP_INTERVAL_MS,
	);
	attachmentSweepTimer.unref?.();
	void runProjectBackfill({ db, eventBus }).catch((error) =>
		console.warn("[host-service] project backfill failed:", error),
	);

	const wsAuth: MiddlewareHandler = async (c, next) => {
		const token = c.req.query("token");
		const authorized =
			(await providers.hostAuth.validate(c.req.raw)) ||
			(token && (await providers.hostAuth.validateToken(token)));
		if (!authorized) return c.json({ error: "Unauthorized" }, 401);
		return next();
	};
	app.use("/terminal/*", wsAuth);
	app.use("/events", wsAuth);
	app.use("/chat-v3/*", wsAuth);

	app.use("/fwd", wsAuth);

	registerEventBusRoute({ app, eventBus, upgradeWebSocket });

	registerForwardMuxRoute({
		app,
		upgradeWebSocket,
		getPortsByWorkspace: (workspaceId) =>
			portManager.getPortsByWorkspace(workspaceId),
	});
	registerWorkspaceTerminalRoute({
		app,
		db,
		eventBus,
		upgradeWebSocket,
		onInput: (terminalId) =>
			terminalAgentStore.invalidateTerminalInput(terminalId),
	});
	registerChatV3Routes({ app, db, mount: chatV3, upgradeWebSocket });
	runtime.teamwork = new TeamworkRuntime(chatAgentContext, {
		peers: {
			...options.peers,
			isManagementToken: (raw) => providers.hostAuth.validateToken(raw),
		},
	});
	runtime.mobileAuth = new MobileAuthService(
		db.$client,
		options.peers?.clock?.now,
	);
	runtime.slots = new DeclarativeSlotService(
		runtime.teamwork.peers,
		options.peers?.home ?? resolveAppHomeDir(),
	);
	const peerHttp = registerPeerIngest(app, runtime.teamwork.peers);
	registerMobileHttp(app, chatAgentContext, runtime.mobileAuth, {
		assets: mobilePublicAssets,
	});
	void runtime.teamwork.ready.catch((error) =>
		console.error("[teamwork] recovery failed", error),
	);
	runtime.butler = createButler(chatAgentContext);
	const butlerHttp = registerButlerHttp({
		app,
		butler: runtime.butler,
		authenticate: (request) => providers.hostAuth.validate(request),
	});
	const memoryHttp = registerMemoryHttp({
		app,
		memory: runtime.memory.memory,
		authenticate: (request) => providers.hostAuth.validate(request),
	});
	app.use("/api/v1/openapi.json", async (c, next) => {
		await next();
		if (c.res.status !== 200) return;
		const document = (await c.res.json()) as {
			paths: OpenApiPaths;
			components?: { securitySchemes?: Record<string, unknown> };
		};
		c.res = new Response(
			JSON.stringify({
				...document,
				paths: mergeOpenApiPaths(
					document.paths,
					memoryHttp.paths,
					butlerHttp.paths,
					peerHttp.paths,
				),
				components: {
					...document.components,
					securitySchemes: {
						...document.components?.securitySchemes,
						...peerHttp.securitySchemes,
					},
				},
			}),
			c.res,
		);
	});
	registerTeamworkHttp({
		app,
		context: chatAgentContext,
		authenticate: (request) => providers.hostAuth.validate(request),
	});

	app.use("/trpc/*", async (c, next) => {
		if (c.req.raw.body !== null && !c.req.raw.bodyUsed) {
			c.req.raw = new Request(c.req.raw, {
				body: await c.req.raw.arrayBuffer(),
			});
		}
		await next();
	});

	app.use(
		"/trpc/*",
		trpcServer({
			router: appRouter,
			// Renderer clients send every request (including queries) as POST —
			// see createHostServiceLinks in @jedv/workspace-client —
			// so a query with a large input (e.g. git.getDiffBulk's file-path
			// list, or a same-tick batch across many workspaces) doesn't produce
			// a GET URL long enough to blow past the header-size limit. Without
			// this flag trpc's default HTTP-method map rejects those POSTs with
			// METHOD_NOT_SUPPORTED before the query ever runs.
			allowMethodOverride: true,
			createContext: async (_opts, c) => {
				const isAuthenticated = await providers.hostAuth.validate(c.req.raw);
				return {
					git,
					credentials: providers.credentials,
					github,
					execGh,

					db,
					runtime,
					eventBus,
					terminalAgentStore,
					organizationId: config.organizationId,
					isAuthenticated,
					clientMachineId:
						c.req.header("x-jedv-client-machine-id") ?? undefined,
					userId: c.req.header(JEDV_USER_ID_HEADER)?.trim() || undefined,
					desktopBridge: config.desktopBridge,
				} satisfies HostServiceContext;
			},
		}),
	);

	const stopAutomationSessions = () => {
		const sessions = runtime.automations?.activeChatSessionIds() ?? [];
		try {
			runtime.automations?.dispose();
		} catch (error) {
			console.error("[host-service] automation shutdown failed", error);
		}
		for (const sessionId of sessions) {
			void runtime
				.chat()
				.commands.closeSession({ sessionId, userClosed: false })
				.catch((error) =>
					console.error(
						"[host-service] automation session shutdown failed",
						error,
					),
				);
		}
	};
	const ownsDb = options.db === undefined;
	const dispose = async (): Promise<void> => {
		removeMemoryWorkspaceListener();
		await runtime.butler?.dispose();
		runtime.butler = undefined;
		await hostMemory?.dispose();
		runtime.memory = undefined;
		await runtime.teamwork?.dispose();
		stopAutomationSessions();
		if (attachmentSweepTimer) clearInterval(attachmentSweepTimer);
		await disposeWorkspaceTitleJobs(db);
		// Each step is best-effort and isolated: a throw in one cleanup must
		// not skip the others, otherwise a flaky `.stop()` could leak the
		// open SQLite handle for the rest of the process lifetime.
		try {
			pullRequestRuntime.stop();
		} catch (err) {
			console.warn("[host-service] pullRequestRuntime.stop failed:", err);
		}
		try {
			await chatV3.dispose();
		} catch (err) {
			console.warn("[host-service] chatV3.dispose failed:", err);
		}
		// Retire the host-worker threads (and reap their in-flight git
		// children) here rather than leaving them to process.exit(): exit joins
		// every Worker, and a worker wedged in native code hangs that join
		// forever. The desktop entry point bounds this dispose with a deadline
		// and hard-exits past it.
		try {
			await getHostWorkerPool().dispose();
		} catch (err) {
			console.warn("[host-service] hostWorkerPool.dispose failed:", err);
		}
		try {
			await disposeUsageWorkerPool();
		} catch (err) {
			console.warn("[host-service] usageWorkerPool.dispose failed:", err);
		}
		try {
			eventBus.close();
		} catch (err) {
			console.warn("[host-service] eventBus.close failed:", err);
		}
		try {
			gitWatcher.close();
		} catch (err) {
			console.warn("[host-service] gitWatcher.close failed:", err);
		}
		if (ownsDb) {
			try {
				(db as unknown as { $client?: { close: () => void } }).$client?.close();
			} catch {
				// best-effort close; tests should not fail on teardown
			}
		}
	};

	const resumeCrashedAgents = async () => {
		const ctx = {
			git,
			credentials: providers.credentials,
			github,
			execGh,

			db,
			runtime,
			eventBus,
			terminalAgentStore,
			organizationId: config.organizationId,
			isAuthenticated: true,
			desktopBridge: config.desktopBridge,
		} as HostServiceContext;
		await resumeCrashedAgentSessions(resumeSessionDepsFor(ctx));
	};

	return {
		app,
		injectWebSocket,

		db,
		eventBus,
		resumeCrashedAgents,
		recoverWorkspaceSetupTerminals: () =>
			recoverWorkspaceSetupTerminals(chatAgentContext),
		recordUnfinishedChats: () => {
			stopAutomationSessions();
			try {
				chatV3.recordUnfinished();
			} catch (error) {
				console.warn(
					"[host-service] could not record unfinished chats:",
					error,
				);
			}
		},
		readLinkedPullRequests: () => pullRequestRuntime.listLinkedPullRequests(),
		onPullRequestLinked: (listener) =>
			pullRequestRuntime.onPullRequestLinked(listener),
		terminalAgentStore,
		memoryRuntime: hostMemory.runtime,
		butlerService: runtime.butler,
		teamworkRuntime: runtime.teamwork,
		mobileAuthService: runtime.mobileAuth,
		slotService: runtime.slots,
		dispose,
	};
}
