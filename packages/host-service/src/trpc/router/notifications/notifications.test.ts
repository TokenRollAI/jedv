import { Database } from "bun:sqlite";
import { describe, expect, it, mock } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveUserHomeDir } from "@jedv/agent-setup";
import type { AgentIdentity } from "@jedv/shared/agent-identity";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import {
	terminalAgentBindings,
	terminalSessions,
	workspaces,
} from "../../../db/schema";
import type { AgentLifecycleEventType } from "../../../events";
import type { WorkspaceChangedMessage } from "../../../events/types";
import { TerminalAgentStore } from "../../../terminal-agents";
import { issueAttributionToken } from "../../../terminal-agents/attribution-token";
import { SqliteTerminalAgentBindingPersistence } from "../../../terminal-agents/persistence";
import type { HostServiceContext } from "../../../types";
import {
	getLocalWorkspace,
	insertLocalWorkspace,
} from "../../../workspaces/local-workspace-store";
import { notificationsRouter } from "./notifications";

interface BroadcastedAgentLifecycleEvent {
	workspaceId: string;
	eventType: AgentLifecycleEventType;
	terminalId: string;
	agent?: AgentIdentity;
	preview?: string;
	occurredAt: number;
}

function createContext(
	originWorkspaceId: string | null,
	options?: { taskId?: string | null },
): {
	ctx: HostServiceContext;
	broadcastAgentLifecycle: ReturnType<
		typeof mock<(event: BroadcastedAgentLifecycleEvent) => void>
	>;
	broadcastAgentBindingsChanged: ReturnType<
		typeof mock<(event: { workspaceId: string; occurredAt: number }) => void>
	>;
	findFirst: ReturnType<typeof mock>;
	taskStart: ReturnType<
		typeof mock<(input: { id: string }) => Promise<unknown>>
	>;
	terminalAgentStore: TerminalAgentStore;
} {
	const broadcastAgentLifecycle = mock(
		(_event: BroadcastedAgentLifecycleEvent) => {},
	);
	const broadcastAgentBindingsChanged = mock(
		(_event: { workspaceId: string; occurredAt: number }) => {},
	);
	const findFirst = mock(() => ({
		sync: () =>
			originWorkspaceId === null
				? null
				: {
						originWorkspaceId,
					},
	}));
	const workspaceFindFirst = mock(() => ({
		sync: () => ({ taskId: options?.taskId ?? null }),
	}));
	const taskStart = mock((_input: { id: string }) => Promise.resolve({}));
	const terminalAgentStore = new TerminalAgentStore();

	const ctx = {
		db: {
			query: {
				terminalSessions: {
					findFirst,
				},
				workspaces: {
					findFirst: workspaceFindFirst,
				},
			},
			// The activity touch (workspaces/local-workspace-store) reads and
			// writes the row; these stubs keep it a silent no-op here. The
			// real write path is covered by the in-memory DB tests below.
			update: () => ({ set: () => ({ where: () => ({ run: () => {} }) }) }),
			select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
		},
		eventBus: {
			broadcastAgentLifecycle,
			broadcastAgentBindingsChanged,
			broadcastWorkspaceChanged: () => {},
		},
		terminalAgentStore,
	} as unknown as HostServiceContext;

	return {
		ctx,
		broadcastAgentLifecycle,
		broadcastAgentBindingsChanged,
		findFirst,
		taskStart,
		terminalAgentStore,
	};
}

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

/**
 * A context over a real migrated in-memory DB, for asserting the row-level
 * side effects of a hook (the activity stamp) rather than the fan-out.
 */
function createDbContext({
	terminalId,
	workspaceId,
}: {
	terminalId: string;
	workspaceId: string;
}): {
	ctx: HostServiceContext;
	db: HostDb;
	workspaceChanged: WorkspaceChangedMessage[];
} {
	const sqlite = new Database(":memory:");
	const bunDb = drizzle(sqlite, { schema });
	migrate(bunDb, { migrationsFolder: MIGRATIONS_FOLDER });
	// bun:sqlite's drizzle type differs from the better-sqlite3-based HostDb,
	// but the query surface used here is identical (same cast as other tests).
	const db = bunDb as unknown as HostDb;

	const workspaceChanged: WorkspaceChangedMessage[] = [];
	const eventBus = {
		broadcastAgentLifecycle: () => {},
		broadcastWorkspaceChanged: (
			message: Omit<WorkspaceChangedMessage, "type">,
		) => {
			workspaceChanged.push({ type: "workspace:changed", ...message });
		},
	};

	insertLocalWorkspace(
		{ db, eventBus: eventBus as unknown as HostServiceContext["eventBus"] },
		{
			id: workspaceId,
			projectId: null,
			worktreePath: `/tmp/${workspaceId}`,
			branch: "feature",
			name: "feature",
		},
	);
	// Start from "never touched" so the first hook must write.
	db.update(workspaces)
		.set({ lastActivityAt: null })
		.where(eq(workspaces.id, workspaceId))
		.run();
	db.insert(terminalSessions)
		.values({ id: terminalId, originWorkspaceId: workspaceId, createdAt: 1 })
		.run();
	workspaceChanged.length = 0;

	const ctx = {
		db,
		eventBus,
		terminalAgentStore: new TerminalAgentStore(),
	} as unknown as HostServiceContext;

	return { ctx, db, workspaceChanged };
}

describe("notificationsRouter.hook", () => {
	it("routes subagent events to the roster without a lifecycle broadcast or session capture", async () => {
		const {
			ctx,
			broadcastAgentLifecycle,
			broadcastAgentBindingsChanged,
			terminalAgentStore,
		} = createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);
		await caller.hook({
			terminalId: "terminal-1",
			eventType: "Start",
			agent: { agentId: "claude", sessionId: "root" },
		});

		const result = await caller.hook({
			terminalId: "terminal-1",
			eventType: "SubagentStart",
			subagent: { id: "a1", type: "Explore" },
		});

		expect(result).toEqual({ success: true, ignored: false });
		expect(broadcastAgentLifecycle).toHaveBeenCalledTimes(1);
		expect(broadcastAgentBindingsChanged).toHaveBeenCalledTimes(1);
		const binding = terminalAgentStore.get("terminal-1");
		expect(binding?.agentSessionId).toBe("root");
		expect(binding?.lastEventType).toBe("Start");
		expect(binding?.subagents?.map((s) => [s.id, s.agentType])).toEqual([
			["a1", "Explore"],
		]);

		await caller.hook({
			terminalId: "terminal-1",
			eventType: "SubagentStop",
			subagent: { id: "a1" },
		});
		expect(terminalAgentStore.get("terminal-1")?.subagents).toBeUndefined();
		expect(broadcastAgentLifecycle).toHaveBeenCalledTimes(1);
	});

	it("resolves transcript paths with the parent binding's harness", async () => {
		const { ctx, terminalAgentStore } = createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);

		await caller.hook({
			terminalId: "terminal-claude",
			eventType: "Start",
			agent: { agentId: "claude", sessionId: "parent" },
		});
		await caller.hook({
			terminalId: "terminal-claude",
			eventType: "SubagentStart",
			subagent: {
				id: "child",
				sessionId: "parent",
				transcriptPath: `${homedir()}/sessions/parent.jsonl`,
			},
		});

		await caller.hook({
			terminalId: "terminal-codex",
			eventType: "Start",
			agent: { agentId: "codex", sessionId: "parent" },
		});
		await caller.hook({
			terminalId: "terminal-codex",
			eventType: "SubagentStart",
			subagent: {
				id: "child",
				sessionId: "parent",
				transcriptPath: `${homedir()}/sessions/parent.jsonl`,
			},
		});

		expect(
			terminalAgentStore.get("terminal-claude")?.subagents?.[0]?.transcriptPath,
		).toBe(`${homedir()}/sessions/parent/subagents/agent-child.jsonl`);
		expect(
			terminalAgentStore.get("terminal-codex")?.subagents?.[0]?.transcriptPath,
		).toBe(`${homedir()}/sessions/parent.jsonl`);
	});

	it("drops a Claude child event that names the parent's previous session", async () => {
		const { ctx, terminalAgentStore } = createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);
		await caller.hook({
			terminalId: "terminal-1",
			eventType: "Start",
			agent: { agentId: "claude", sessionId: "s2" },
		});
		const result = await caller.hook({
			terminalId: "terminal-1",
			eventType: "SubagentStart",
			subagent: { id: "old-child", sessionId: "s1" },
		});
		expect(result).toEqual({ success: true, ignored: true });
		expect(terminalAgentStore.get("terminal-1")?.subagents).toBeUndefined();
	});

	it("keeps only transcript paths that look like harness files under home", async () => {
		const { ctx, terminalAgentStore } = createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);
		await caller.hook({
			terminalId: "terminal-1",
			eventType: "Start",
			agent: { agentId: "codex", sessionId: "root" },
		});
		await caller.hook({
			terminalId: "terminal-1",
			eventType: "SubagentStart",
			subagent: { id: "c1", transcriptPath: "/etc/passwd" },
		});
		expect(
			terminalAgentStore.get("terminal-1")?.subagents?.[0]?.transcriptPath,
		).toBeUndefined();
	});

	it("derives workspaceId from terminalId before broadcasting", async () => {
		const { ctx, broadcastAgentLifecycle, findFirst } =
			createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);

		const result = await caller.hook({
			terminalId: "terminal-1",
			eventType: "task_complete",
		});

		expect(result).toEqual({ success: true, ignored: false });
		expect(findFirst).toHaveBeenCalledTimes(1);
		expect(broadcastAgentLifecycle).toHaveBeenCalledTimes(1);
		expect(broadcastAgentLifecycle.mock.calls[0]?.[0]).toMatchObject({
			workspaceId: "workspace-1",
			eventType: "Stop",
			terminalId: "terminal-1",
		});
		expect(typeof broadcastAgentLifecycle.mock.calls[0]?.[0].occurredAt).toBe(
			"number",
		);
	});

	it("ignores missing or unknown terminal ids", async () => {
		const missingTerminal = createContext("workspace-1");
		const missingResult = await notificationsRouter
			.createCaller(missingTerminal.ctx)
			.hook({ eventType: "Stop" });

		expect(missingResult).toEqual({ success: true, ignored: true });
		expect(missingTerminal.findFirst).not.toHaveBeenCalled();
		expect(missingTerminal.broadcastAgentLifecycle).not.toHaveBeenCalled();

		const unknownTerminal = createContext(null);
		const unknownResult = await notificationsRouter
			.createCaller(unknownTerminal.ctx)
			.hook({ terminalId: "terminal-missing", eventType: "Stop" });

		expect(unknownResult).toEqual({ success: true, ignored: true });
		expect(unknownTerminal.findFirst).toHaveBeenCalledTimes(1);
		expect(unknownTerminal.broadcastAgentLifecycle).not.toHaveBeenCalled();
	});

	it("ignores unknown event types before looking up the terminal", async () => {
		const { ctx, broadcastAgentLifecycle, findFirst } =
			createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);

		const result = await caller.hook({
			terminalId: "terminal-1",
			eventType: "unknown-event",
		});

		expect(result).toEqual({ success: true, ignored: true });
		expect(findFirst).not.toHaveBeenCalled();
		expect(broadcastAgentLifecycle).not.toHaveBeenCalled();
	});

	it("forwards agent identity when the hook stamps it", async () => {
		const { ctx, broadcastAgentLifecycle } = createContext("workspace-1");

		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "Stop",
			agent: { agentId: "claude", sessionId: "session-abc" },
		});

		expect(broadcastAgentLifecycle).toHaveBeenCalledTimes(1);
		expect(broadcastAgentLifecycle.mock.calls[0]?.[0]).toMatchObject({
			workspaceId: "workspace-1",
			terminalId: "terminal-1",
			eventType: "Stop",
			agent: { agentId: "claude", sessionId: "session-abc" },
		});
	});

	it("normalizes empty-string identity fields to undefined", async () => {
		const { ctx, broadcastAgentLifecycle } = createContext("workspace-1");

		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "Stop",
			agent: { agentId: "claude", sessionId: "" },
		});

		const broadcast = broadcastAgentLifecycle.mock.calls[0]?.[0];
		expect(broadcast?.agent).toEqual({ agentId: "claude" });
	});

	it("records the event onto the terminal agent store", async () => {
		const { ctx, terminalAgentStore } = createContext("workspace-1");

		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "SessionStart",
			agent: { agentId: "claude", sessionId: "session-abc" },
		});

		const binding = terminalAgentStore.get("terminal-1");
		expect(binding?.agentId).toBe("claude");
		expect(binding?.agentSessionId).toBe("session-abc");
		expect(binding?.workspaceId).toBe("workspace-1");
		expect(binding?.lastEventType).toBe("Attached");
	});

	it("maps Claude Code's StopFailure API-error hook to a Failed event and records it", async () => {
		const { ctx, broadcastAgentLifecycle, terminalAgentStore } =
			createContext("workspace-1");
		const caller = notificationsRouter.createCaller(ctx);

		await caller.hook({
			terminalId: "terminal-1",
			eventType: "SessionStart",
			agent: { agentId: "claude", sessionId: "session-abc" },
		});
		const result = await caller.hook({
			terminalId: "terminal-1",
			eventType: "StopFailure",
			agent: { agentId: "claude", sessionId: "session-abc" },
		});

		expect(result).toEqual({ success: true, ignored: false });
		const failedBroadcast = broadcastAgentLifecycle.mock.calls.at(-1)?.[0];
		expect(failedBroadcast).toMatchObject({
			workspaceId: "workspace-1",
			eventType: "Failed",
			terminalId: "terminal-1",
			// Failed keeps the agent identifiable, unlike an exit that drops it.
			agent: { agentId: "claude", sessionId: "session-abc" },
		});
		const binding = terminalAgentStore.get("terminal-1");
		expect(binding?.lastEventType).toBe("Failed");
		expect(binding?.agentId).toBe("claude");
		expect(binding?.agentSessionId).toBe("session-abc");
	});

	it("does not call cloud tasks for linked workspace activity", async () => {
		const { ctx, taskStart } = createContext("workspace-1", {
			taskId: "old-task",
		});
		const caller = notificationsRouter.createCaller(ctx);
		await caller.hook({ terminalId: "terminal-1", eventType: "Start" });
		expect(taskStart).not.toHaveBeenCalled();
	});

	it("does not nudge the task when the workspace has no linked task", async () => {
		const { ctx, taskStart } = createContext("workspace-1", { taskId: null });

		await notificationsRouter
			.createCaller(ctx)
			.hook({ terminalId: "terminal-1", eventType: "Start" });

		expect(taskStart).not.toHaveBeenCalled();
	});

	it("does not nudge the task on non-Start events", async () => {
		const { ctx, taskStart } = createContext("workspace-1", {
			taskId: "task-nudge-stop",
		});

		await notificationsRouter
			.createCaller(ctx)
			.hook({ terminalId: "terminal-1", eventType: "Stop" });

		expect(taskStart).not.toHaveBeenCalled();
	});

	it("drops agent identity entirely when agentId is missing", async () => {
		const { ctx, broadcastAgentLifecycle } = createContext("workspace-1");

		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "Stop",
			agent: { agentId: "" },
		});

		const broadcast = broadcastAgentLifecycle.mock.calls[0]?.[0];
		expect(broadcast?.agent).toBeUndefined();
	});

	it("stamps the terminal's workspace lastActivityAt and broadcasts it", async () => {
		const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		const { ctx, db, workspaceChanged } = createDbContext({
			terminalId: "terminal-activity",
			workspaceId,
		});
		const updatedAtBefore = getLocalWorkspace(db, workspaceId)?.updatedAt;
		const before = Date.now();

		const result = await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-activity",
			eventType: "UserPromptSubmit",
			agent: { agentId: "claude", sessionId: "session-abc" },
		});

		expect(result).toEqual({ success: true, ignored: false });
		const row = getLocalWorkspace(db, workspaceId);
		expect(row?.lastActivityAt ?? 0).toBeGreaterThanOrEqual(before);
		// Activity is not a metadata edit.
		expect(row?.updatedAt).toBe(updatedAtBefore);
		expect(workspaceChanged).toHaveLength(1);
		expect(workspaceChanged[0]).toMatchObject({
			workspaceId,
			eventType: "updated",
			workspace: { id: workspaceId, lastActivityAt: row?.lastActivityAt },
		});
	});

	it("does not fail the hook when the activity write throws", async () => {
		const { ctx, broadcastAgentLifecycle } = createContext("workspace-1");
		(ctx.db as unknown as { update: () => never }).update = () => {
			throw new Error("disk full");
		};
		const warn = console.warn;
		const warnings: unknown[][] = [];
		console.warn = (...args: unknown[]) => {
			warnings.push(args);
		};
		try {
			const result = await notificationsRouter
				.createCaller(ctx)
				.hook({ terminalId: "terminal-1", eventType: "Stop" });

			expect(result).toEqual({ success: true, ignored: false });
			expect(broadcastAgentLifecycle).toHaveBeenCalledTimes(1);
			expect(
				warnings.some((args) =>
					String(args[0]).includes("failed to record activity"),
				),
			).toBe(true);
		} finally {
			console.warn = warn;
		}
	});
});

it("broadcasts a bounded preview with the lifecycle event", async () => {
	const { ctx, broadcastAgentLifecycle } = createContext("workspace-1");
	await notificationsRouter.createCaller(ctx).hook({
		terminalId: "terminal-1",
		eventType: "Stop",
		preview: "x".repeat(5000),
	});
	expect(broadcastAgentLifecycle.mock.calls[0]?.[0].preview).toBe(
		"x".repeat(4000),
	);
});

describe("reported transcript path", () => {
	function createPersistedContext() {
		const context = createDbContext({
			terminalId: "terminal-1",
			workspaceId: "workspace-1",
		});
		context.ctx.terminalAgentStore = new TerminalAgentStore(
			new SqliteTerminalAgentBindingPersistence(context.db),
		);
		return context;
	}

	function storedPath(db: HostDb) {
		return db
			.select({ path: terminalAgentBindings.transcriptPath })
			.from(terminalAgentBindings)
			.where(eq(terminalAgentBindings.terminalId, "terminal-1"))
			.get()?.path;
	}

	it("keeps the main session's transcript path on its binding", async () => {
		const { ctx, db } = createPersistedContext();
		const transcriptPath = resolve(
			resolveUserHomeDir(),
			".claude/projects/-tmp-workspace-1/s-1.jsonl",
		);
		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "Stop",
			agent: { agentId: "claude", sessionId: "s-1" },
			transcriptPath,
		});
		expect(storedPath(db)).toBe(transcriptPath);
	});

	it("drops a path the unauthenticated hook could use to point outside home", async () => {
		const { ctx, db } = createPersistedContext();
		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "Stop",
			agent: { agentId: "claude", sessionId: "s-1" },
			transcriptPath: "/etc/s-1.jsonl",
		});
		expect(storedPath(db)).toBeNull();
	});
});

describe("automatic delivery hook boundary", () => {
	function setup(agentId: "claude" | "codex" = "claude") {
		const {
			ctx,
			terminalAgentStore: store,
			broadcastAgentLifecycle,
		} = createContext("workspace-1");
		const identity = {
			terminalId: "terminal-1",
			launchId: "launch-1",
			agent: { agentId, sessionId: "session-1" },
			attributionToken: issueAttributionToken("terminal-1"),
		};
		store.recordEvent({
			terminalId: identity.terminalId,
			workspaceId: "workspace-1",
			agentId,
			agentSessionId: "session-1",
			launchId: identity.launchId,
			eventType: "Attached",
			occurredAt: 1,
		});
		const expected = store.get(identity.terminalId);
		if (!expected) throw new Error("Missing fixture binding");
		return {
			caller: notificationsRouter.createCaller(ctx),
			broadcastAgentLifecycle,
			store,
			identity,
			expected,
		};
	}

	for (const manualDraft of [false, true]) {
		it(`ignores an authenticated stale wrapper Start while preserving ${manualDraft ? "manual draft protection" : "native idle evidence"}`, async () => {
			const { caller, store, identity, expected, broadcastAgentLifecycle } =
				setup("codex");
			await caller.hook({
				...identity,
				eventType: "Start",
				deliverySequence: 16,
			});
			if (manualDraft) store.invalidateAutomaticDelivery(expected);
			const before = store.get(identity.terminalId);
			const beforeInput = store.getNativeInputStatus(expected);
			const broadcasts = broadcastAgentLifecycle.mock.calls.length;
			for (const deliverySequence of [15, 16]) {
				expect(
					await caller.hook({
						...identity,
						agent: { agentId: "codex" },
						eventType: "Start",
						deliverySequence,
					}),
				).toEqual({ success: true, ignored: true });
			}
			expect(store.get(identity.terminalId)).toEqual(before);
			expect(store.getNativeInputStatus(expected)).toBe(beforeInput);
			expect(broadcastAgentLifecycle.mock.calls.length).toBe(broadcasts);
			for (
				let deliverySequence = 17;
				deliverySequence <= 20;
				deliverySequence++
			) {
				await caller.hook({
					...identity,
					eventType: "PostToolUse",
					deliverySequence,
				});
			}
			await caller.hook({
				...identity,
				eventType: "Stop",
				deliverySequence: 21,
			});
			expect(store.getNativeInputStatus(expected)).toBe(
				manualDraft ? "manual-input" : "clean",
			);
			expect(store.getAutomaticDeliveryState(expected)).toBe(
				manualDraft ? "unknown" : "idle",
			);
			expect(store.acquireAutomaticDelivery(expected)?.isValid() ?? false).toBe(
				!manualDraft,
			);
		});
	}

	for (const boundary of [
		"missing-token",
		"wrong-token",
		"launch",
		"provider",
		"workspace",
		"new-sequence",
		"missing-sequence",
		"other-event",
	] as const) {
		it(`does not discard a no-session hook at the ${boundary} boundary`, async () => {
			const { caller, store, identity } = setup("codex");
			await caller.hook({
				...identity,
				eventType: "Start",
				deliverySequence: 16,
			});
			if (boundary === "workspace") {
				const binding = store.get(identity.terminalId);
				if (!binding) throw new Error("Missing fixture binding");
				store.recordEvent({
					...binding,
					workspaceId: "different-workspace",
					eventType: "Attached",
					occurredAt: 2,
				});
			}
			const result = await caller.hook({
				...identity,
				agent: { agentId: boundary === "provider" ? "claude" : "codex" },
				eventType: boundary === "other-event" ? "PostToolUse" : "Start",
				deliverySequence:
					boundary === "missing-sequence"
						? undefined
						: boundary === "new-sequence"
							? 17
							: 15,
				attributionToken:
					boundary === "missing-token"
						? undefined
						: boundary === "wrong-token"
							? issueAttributionToken("other-terminal")
							: identity.attributionToken,
				launchId:
					boundary === "launch" ? "different-launch" : identity.launchId,
			});
			expect(result.ignored).toBe(false);
			const current = store.get(identity.terminalId);
			if (!current) throw new Error("Missing current binding");
			expect(store.getNativeInputStatus(current)).not.toBe("clean");
			expect(store.acquireAutomaticDelivery(current)).toBeNull();
		});
	}

	it("validates a real terminal token and consumes ordered hook idle once", async () => {
		const { caller, store, identity, expected } = setup();
		await caller.hook({
			...identity,
			eventType: "UserPromptSubmit",
			deliverySequence: 1,
		});
		await caller.hook({ ...identity, eventType: "Stop", deliverySequence: 2 });
		const permit = store.acquireAutomaticDelivery(expected);
		expect(permit?.isValid()).toBe(true);
		await caller.hook({ ...identity, eventType: "Stop", deliverySequence: 2 });
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		await caller.hook({
			...identity,
			eventType: "UserPromptSubmit",
			deliverySequence: 3,
		});
		// Receipt time is assigned by the receiver; only source sequence orders it.
		await caller.hook({ ...identity, eventType: "Stop", deliverySequence: 2 });
		expect(store.getAutomaticDeliveryState(expected)).toBe("working");
		expect(store.acquireAutomaticDelivery(expected)).toBeNull();
		await caller.hook({ ...identity, eventType: "Stop", deliverySequence: 4 });
		expect(store.acquireAutomaticDelivery(expected)?.isValid()).toBe(true);
	});

	for (const missing of [
		"token",
		"wrong-token",
		"launch",
		"session",
		"sequence",
	] as const) {
		it(`keeps ${missing} hooks display-compatible without granting input authority`, async () => {
			const { caller, store, identity, expected } = setup();
			const input = {
				...identity,
				...(missing === "token" ? { attributionToken: undefined } : {}),
				...(missing === "wrong-token"
					? { attributionToken: issueAttributionToken("other-terminal") }
					: {}),
				...(missing === "launch" ? { launchId: "old-launch" } : {}),
				...(missing === "session"
					? { agent: { agentId: "claude", sessionId: "old-session" } }
					: {}),
			};
			await caller.hook({
				...input,
				eventType: "UserPromptSubmit",
				deliverySequence: missing === "sequence" ? undefined : 1,
			});
			await caller.hook({
				...input,
				eventType: "Stop",
				deliverySequence: missing === "sequence" ? undefined : 2,
			});
			expect(store.get(identity.terminalId)?.lastEventType).toBe("Stop");
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
			const current = store.get(identity.terminalId);
			if (!current) throw new Error("Missing current binding");
			expect(store.acquireAutomaticDelivery(current)).toBeNull();
		});
	}

	for (const eventType of ["PermissionRequest", "Interrupt"]) {
		it(`does not authorize a normalized Stop after ${eventType}`, async () => {
			const { caller, store, identity, expected } = setup();
			await caller.hook({
				...identity,
				eventType: "UserPromptSubmit",
				deliverySequence: 1,
			});
			await caller.hook({ ...identity, eventType, deliverySequence: 2 });
			await caller.hook({
				...identity,
				eventType: "Stop",
				deliverySequence: 3,
			});
			expect(store.acquireAutomaticDelivery(expected)).toBeNull();
			expect(store.getAutomaticDeliveryState(expected)).toBe(
				eventType === "Interrupt" ? "interrupted" : "permission",
			);
		});
	}

	it("cannot bootstrap authority using only a token and Stop on an unbound terminal", async () => {
		const { ctx, terminalAgentStore: store } = createContext("workspace-1");
		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			launchId: "claimed-launch",
			deliverySequence: 1,
			attributionToken: issueAttributionToken("terminal-1"),
			agent: { agentId: "claude", sessionId: "claimed-session" },
			eventType: "Stop",
		});
		const current = store.get("terminal-1");
		if (!current) throw new Error("Missing display binding");
		expect(store.acquireAutomaticDelivery(current)).toBeNull();
	});
});

describe("login attribution authentication", () => {
	it("publishes launch events after the binding and account are readable", async () => {
		const { ctx, terminalAgentStore, broadcastAgentLifecycle } =
			createContext("workspace-1");
		const observed: unknown[] = [];
		broadcastAgentLifecycle.mockImplementation(() => {
			observed.push(terminalAgentStore.get("terminal-1"));
		});
		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "SessionStart",
			agent: { agentId: "codex" },
			accountProfile: "",
			apiKey: true,
			attributionToken: issueAttributionToken("terminal-1"),
		});
		expect(observed).toEqual([
			expect.objectContaining({
				agentId: "codex",
				workspaceId: "workspace-1",
				account: expect.objectContaining({ identity: "api-env" }),
			}),
		]);
	});

	for (const authorized of [false, true]) {
		it(`records lifecycle events with ${authorized ? "verified" : "unverified"} attribution`, async () => {
			const { ctx, terminalAgentStore } = createContext("workspace-1");
			const caller = notificationsRouter.createCaller(ctx);
			await caller.hook({
				terminalId: "terminal-1",
				eventType: "SessionStart",
				agent: { agentId: "claude" },
				accountProfile: "",
				apiKey: true,
				attributionToken: issueAttributionToken(
					authorized ? "terminal-1" : "other-terminal",
				),
			});
			expect(terminalAgentStore.get("terminal-1")?.agentId).toBe("claude");
			expect(terminalAgentStore.get("terminal-1")?.account?.identity).toBe(
				authorized ? "api-env" : undefined,
			);
		});
	}
	it("does not attribute unauthenticated API billing claims", async () => {
		const { ctx, terminalAgentStore } = createContext("workspace-1");
		await notificationsRouter.createCaller(ctx).hook({
			terminalId: "terminal-1",
			eventType: "SessionStart",
			agent: { agentId: "claude" },
			accountProfile: "",
			apiKey: true,
		});
		expect(terminalAgentStore.get("terminal-1")?.account).toBeUndefined();
	});
});
