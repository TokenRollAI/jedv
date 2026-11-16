import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { EventEmitter, once } from "node:events";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import {
	markResumeCandidateResumedInto,
	markTerminalAgentBindingEnded,
	SqliteTerminalAgentBindingPersistence,
} from "../terminal-agents/persistence";
import { TerminalAgentStore } from "../terminal-agents/store";
import type { HostServiceContext } from "../types";
import { TeamService, type TeamServiceDependencies } from "./service";

const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const close of cleanup.splice(0)) close();
});

async function fixture() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	migrate(db as never, {
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
	});
	for (const id of ["workspace", "other-workspace"])
		db.insert(schema.workspaces)
			.values({
				id,
				type: "session",
				worktreePath: `/unused/${id}`,
				branch: "",
			})
			.run();
	db.insert(schema.terminalSessions)
		.values({
			id: "old-terminal",
			originWorkspaceId: "workspace",
			createdAt: 1,
		})
		.run();
	const store = new TerminalAgentStore(
		new SqliteTerminalAgentBindingPersistence(db),
	);
	store.recordEvent({
		terminalId: "old-terminal",
		workspaceId: "workspace",
		agentId: "codex",
		launchId: "old-launch",
		agentSessionId: "native-session",
		eventType: "Attached",
		occurredAt: 2,
	});
	const events = new EventEmitter();
	const probes: string[] = [];
	let alive: TeamServiceDependencies["alive"] = async () => true;
	const ctx = {
		db,
		terminalAgentStore: store,
		runtime: {},
		eventBus: {
			broadcastTeamChanged: () => {},
			onTerminalLifecycle: (listener: (...args: unknown[]) => void) => {
				events.on("terminal", listener);
				return () => events.off("terminal", listener);
			},
		},
	} as unknown as HostServiceContext;
	const team = new TeamService(ctx, {
		now: () => 100,
		alive: async (input) => {
			probes.push(input.terminalId);
			return alive?.(input) ?? false;
		},
		launch: async () => {
			throw new Error("Recovery must not launch a process");
		},
		dispose: async (terminalId) => ({
			terminalId,
			daemonCloseAttempted: true,
			daemonCloseSucceeded: true,
		}),
	});
	cleanup.push(() => {
		team.dispose();
		sqlite.close();
	});
	const result = await team.init({
		actor: {
			terminalId: "old-terminal",
			workspaceId: "workspace",
			launchId: "old-launch",
		},
		name: "Recovery",
		goal: "Preserve the conversation",
		leaderName: "leader",
	});
	const memberId = result.members[0]?.id;
	if (!memberId) throw new Error("Missing fixture member");
	probes.length = 0;
	const completeResume = () => {
		// The real reaper can persist death before the live store emits an event.
		markTerminalAgentBindingEnded(db, "old-terminal", "terminal-exited", 10);
		db.update(schema.terminalSessions)
			.set({ status: "exited", endedAt: 10 })
			.where(eq(schema.terminalSessions.id, "old-terminal"))
			.run();
		team.status({ teamId: result.team.id });
		db.insert(schema.terminalSessions)
			.values({
				id: "new-terminal",
				originWorkspaceId: "workspace",
				createdAt: 20,
			})
			.run();
		store.recordEvent({
			terminalId: "new-terminal",
			workspaceId: "workspace",
			agentId: "codex",
			launchId: "new-launch",
			agentSessionId: "native-session",
			eventType: "Attached",
			occurredAt: 21,
		});
		db.update(schema.terminalAgentBindings)
			.set({ endReason: "resumed" })
			.where(eq(schema.terminalAgentBindings.terminalId, "old-terminal"))
			.run();
		markResumeCandidateResumedInto(db, "old-terminal", "new-terminal");
	};
	return {
		db,
		store,
		team,
		events,
		probes,
		memberId,
		teamId: result.team.id,
		completeResume,
		setAlive: (value: NonNullable<TeamServiceDependencies["alive"]>) => {
			alive = value;
		},
	};
}

test("a binding ended outside the live store cannot keep a Team member shown as bound", async () => {
	const f = await fixture();
	markTerminalAgentBindingEnded(f.db, "old-terminal", "terminal-exited", 10);
	const member = f.team.status({ teamId: f.teamId }).members[0];
	expect(member?.status).toBe("reconcile_required");
	expect(member?.launchState).toBe("reconcile_required");
	expect(member?.binding).toBeNull();
	expect(() =>
		f.team.resolveActor({
			terminalId: "old-terminal",
			workspaceId: "workspace",
		}),
	).toThrow();
});

test.each([
	"event",
	"reconcile",
])("a proven same-conversation resume preserves member and Mail identity through %s", async (trigger) => {
	const f = await fixture();
	const original = f.team.member(f.memberId);
	f.completeResume();
	if (trigger === "event") {
		const changed = once(f.team, "change");
		f.events.emit("terminal", {
			eventType: "resumed",
			terminalId: "old-terminal",
			resumedTerminalId: "new-terminal",
			workspaceId: "workspace",
			label: "Codex",
			occurredAt: 30,
		});
		await changed;
	} else await f.team.recover();
	const member = f.team.member(f.memberId);
	expect(member.id).toBe(original.id);
	expect(member.operationId).toBe(original.operationId);
	expect(member.requestJson).toBe(original.requestJson);
	expect(member.terminalId).toBe("new-terminal");
	expect(member.plannedTerminalId).toBe("new-terminal");
	expect(member.expectedLaunchId).toBe("new-launch");
	expect(member.boundAgentSessionId).toBe("native-session");
	expect(member.boundStartedAt).toBe(21);
	expect(member.status).toBe("active");
	expect(f.team.binding(member)?.terminalId).toBe("new-terminal");
	expect(
		f.team.status({ teamId: f.teamId }).members[0]?.deliveryState,
	).not.toBe("idle");
	expect(
		f.team.resolveActor({
			terminalId: "new-terminal",
			workspaceId: "workspace",
			launchId: "new-launch",
		}).id,
	).toBe(member.id);
	expect(() =>
		f.team.resolveActor({
			terminalId: "old-terminal",
			workspaceId: "workspace",
			launchId: "old-launch",
		}),
	).toThrow();
	await f.team.recover();
	expect(f.probes).toEqual(["new-terminal"]);
});

test.each([
	"no-link",
	"not-resumed",
	"old-session",
	"old-launch",
	"old-start",
	"old-workspace",
	"old-config",
	"new-session",
	"new-agent",
	"new-workspace",
	"new-config",
	"new-launch",
	"chat",
	"terminal-workspace",
	"terminal-dead",
	"terminal-disposing",
	"workspace-archived",
	"old-terminal-live",
	"dead-process",
	"persisted-successor",
])("recovery rejects missing or mismatched identity evidence: %s", async (mismatch) => {
	const f = await fixture();
	f.completeResume();
	const previousPatch: Partial<
		typeof schema.terminalAgentBindings.$inferInsert
	> = {};
	if (mismatch === "no-link") previousPatch.resumedIntoTerminalId = null;
	if (mismatch === "not-resumed") previousPatch.endReason = "terminal-exited";
	if (mismatch === "old-session")
		previousPatch.agentSessionId = "other-session";
	if (mismatch === "old-launch") previousPatch.launchId = "other-launch";
	if (mismatch === "old-start") previousPatch.startedAt = 500;
	if (mismatch === "old-workspace")
		previousPatch.workspaceId = "other-workspace";
	if (mismatch === "old-config") previousPatch.definitionId = "claude";
	if (Object.keys(previousPatch).length)
		f.db
			.update(schema.terminalAgentBindings)
			.set(previousPatch)
			.where(eq(schema.terminalAgentBindings.terminalId, "old-terminal"))
			.run();
	if (
		[
			"new-session",
			"new-agent",
			"new-workspace",
			"new-config",
			"new-launch",
			"chat",
		].includes(mismatch)
	) {
		f.store.markTerminalDisposed("new-terminal");
		const event = {
			terminalId: "new-terminal",
			workspaceId:
				mismatch === "new-workspace" ? "other-workspace" : "workspace",
			agentId:
				mismatch === "new-agent" ? ("claude" as const) : ("codex" as const),
			launchId: mismatch === "new-launch" ? undefined : "replacement-launch",
			agentSessionId:
				mismatch === "new-session" ? "another-session" : "native-session",
			definitionId: mismatch === "new-config" ? ("claude" as const) : undefined,
			eventType: "Attached",
			occurredAt: 40,
		};
		if (mismatch === "chat")
			f.store.recordChatEvent({ ...event, chatSessionId: "chat" });
		else f.store.recordEvent(event);
	}
	if (mismatch === "terminal-workspace")
		f.db
			.update(schema.terminalSessions)
			.set({ originWorkspaceId: "other-workspace" })
			.where(eq(schema.terminalSessions.id, "new-terminal"))
			.run();
	if (mismatch === "terminal-dead")
		f.db
			.update(schema.terminalSessions)
			.set({ status: "exited", endedAt: 50 })
			.where(eq(schema.terminalSessions.id, "new-terminal"))
			.run();
	if (mismatch === "terminal-disposing")
		f.db
			.update(schema.terminalSessions)
			.set({ disposeRequestedAt: 50 })
			.where(eq(schema.terminalSessions.id, "new-terminal"))
			.run();
	if (mismatch === "workspace-archived")
		f.db
			.update(schema.workspaces)
			.set({ archivedAt: 50 })
			.where(eq(schema.workspaces.id, "workspace"))
			.run();
	if (mismatch === "old-terminal-live")
		f.db
			.update(schema.terminalSessions)
			.set({ status: "active", endedAt: null })
			.where(eq(schema.terminalSessions.id, "old-terminal"))
			.run();
	if (mismatch === "dead-process") f.setAlive(async () => false);
	if (mismatch === "persisted-successor")
		f.db
			.update(schema.terminalAgentBindings)
			.set({ launchId: "changed-on-disk" })
			.where(eq(schema.terminalAgentBindings.terminalId, "new-terminal"))
			.run();
	await f.team.recover();
	expect(f.team.member(f.memberId).terminalId).toBe("old-terminal");
	expect(f.team.member(f.memberId).status).toBe("reconcile_required");
});

test("recovery does not claim a successor already assigned to another Team", async () => {
	const f = await fixture();
	f.completeResume();
	const other = await f.team.init({
		actor: {
			terminalId: "new-terminal",
			workspaceId: "workspace",
			launchId: "new-launch",
		},
		name: "Explicit new Team",
		goal: "A separate task",
		leaderName: "leader",
	});
	await f.team.recover();
	expect(f.team.member(f.memberId).status).toBe("reconcile_required");
	expect(f.team.member(f.memberId).terminalId).toBe("old-terminal");
	expect(
		f.team.status({ teamId: other.team.id }).members[0]?.binding?.terminalId,
	).toBe("new-terminal");
});

test("adoption metadata and a newer hook do not change the resumed terminal identity", async () => {
	const f = await fixture();
	f.completeResume();
	f.setAlive(async () => {
		f.db
			.update(schema.terminalSessions)
			.set({ lastAttachedAt: 100, customTitle: "Resumed" })
			.where(eq(schema.terminalSessions.id, "new-terminal"))
			.run();
		f.store.recordEvent({
			terminalId: "new-terminal",
			workspaceId: "workspace",
			agentId: "codex",
			launchId: "new-launch",
			agentSessionId: "native-session",
			eventType: "Start",
			occurredAt: 100,
		});
		return true;
	});
	await f.team.recover();
	expect(f.team.member(f.memberId).terminalId).toBe("new-terminal");
	expect(f.team.member(f.memberId).status).toBe("active");
});

test.each([
	"stop",
	"archive",
	"member",
	"terminal",
	"binding",
	"workspace",
])("a delayed liveness probe cannot overwrite concurrent %s", async (change) => {
	const f = await fixture();
	f.completeResume();
	let release!: (alive: boolean) => void;
	let admitted!: () => void;
	const started = new Promise<void>((resolve) => {
		admitted = resolve;
	});
	f.setAlive(async () => {
		admitted();
		return new Promise<boolean>((resolve) => {
			release = resolve;
		});
	});
	const recovery = f.team.recover();
	await started;
	if (change === "stop" || change === "archive") {
		await f.team.stop({ teamId: f.teamId });
		if (change === "archive")
			await f.team.archive({ teamId: f.teamId, stop: false });
	}
	if (change === "member")
		f.db
			.update(schema.teamMembers)
			.set({ expectedLaunchId: "different-member-launch" })
			.where(eq(schema.teamMembers.id, f.memberId))
			.run();
	if (change === "terminal")
		f.db
			.update(schema.terminalSessions)
			.set({ createdAt: 999 })
			.where(eq(schema.terminalSessions.id, "new-terminal"))
			.run();
	if (change === "binding")
		f.store.recordEvent({
			terminalId: "new-terminal",
			workspaceId: "workspace",
			agentId: "codex",
			launchId: "another-launch",
			agentSessionId: "native-session",
			eventType: "Attached",
			occurredAt: 100,
		});
	if (change === "workspace")
		f.db
			.update(schema.workspaces)
			.set({ archivedAt: 999 })
			.where(eq(schema.workspaces.id, "workspace"))
			.run();
	release(true);
	await recovery;
	expect(f.team.member(f.memberId).terminalId).toBe("old-terminal");
	expect(f.team.member(f.memberId).status).toBe(
		change === "stop" || change === "archive"
			? "stopped"
			: "reconcile_required",
	);
});
