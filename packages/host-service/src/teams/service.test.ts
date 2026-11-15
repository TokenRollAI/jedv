import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { type MailDependencies, MailService } from "../mail/service";
import type { createTerminalSessionInternal } from "../terminal/terminal";
import { TerminalAgentStore } from "../terminal-agents/store";
import type { HostServiceContext } from "../types";
import { TeamService, type TeamServiceDependencies } from "./service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
function fixture(
	options: { team?: TeamServiceDependencies; mail?: MailDependencies } = {},
) {
	const repoPath = mkdtempSync(join(tmpdir(), "jedv-team-unit-"));
	mkdirSync(join(repoPath, ".git"));
	cleanups.push(async () => rmSync(repoPath, { recursive: true, force: true }));
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	migrate(db as never, {
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
	});
	sqlite.exec("PRAGMA foreign_keys=ON");
	db.insert(schema.projects)
		.values({ id: "p1", repoPath, name: "Project" })
		.run();
	for (const id of ["w1", "w2"])
		db.insert(schema.workspaces)
			.values({
				id,
				projectId: "p1",
				worktreePath: `/tmp/team-unit-${id}`,
				branch: "main",
			})
			.run();
	db.insert(schema.hostAgentConfigs)
		.values({
			id: "config",
			presetId: "claude",
			label: "Fixture",
			command: "/bin/echo",
			promptTransport: "argv",
			displayOrder: 0,
		})
		.run();
	db.insert(schema.terminalSessions)
		.values({ id: "leader-terminal", originWorkspaceId: "w1" })
		.run();
	const store = new TerminalAgentStore();
	store.recordEvent({
		terminalId: "leader-terminal",
		workspaceId: "w1",
		agentId: "claude",
		launchId: "leader-launch",
		agentSessionId: "leader-session",
		eventType: "Attached",
		occurredAt: 1,
	});
	let clock = 100_000;
	const events = new EventEmitter();
	const ctx = {
		db,
		terminalAgentStore: store,
		runtime: {},
		eventBus: {
			broadcastTeamChanged: () => {},
			broadcastMailChanged: () => {},
			onTerminalLifecycle: (fn: (...args: unknown[]) => void) => {
				events.on("terminal", fn);
				return () => events.off("terminal", fn);
			},
		},
	} as unknown as HostServiceContext;
	const killed: string[] = [],
		launches: string[] = [];
	const team = new TeamService(ctx, {
		now: () => clock,
		trust: async () => {},
		alive: async () => true,
		launch: async (input) => {
			const intent = db
				.select()
				.from(schema.teamMembers)
				.where(eq(schema.teamMembers.plannedTerminalId, input.terminalId))
				.get();
			expect(intent?.terminalId).toBeNull();
			expect(intent?.status).toBe("spawning");
			launches.push(input.terminalId);
			db.insert(schema.terminalSessions)
				.values({ id: input.terminalId, originWorkspaceId: input.workspaceId })
				.run();
			store.recordEvent({
				terminalId: input.terminalId,
				workspaceId: input.workspaceId,
				agentId: "claude",
				launchId: intent?.expectedLaunchId ?? "",
				agentSessionId: input.terminalId,
				eventType: "Attached",
				occurredAt: 1,
			});
			return { terminalId: input.terminalId } as Awaited<
				ReturnType<typeof createTerminalSessionInternal>
			>;
		},
		dispose: async (id) => {
			killed.push(id);
			return {
				terminalId: id,
				daemonCloseAttempted: true,
				daemonCloseSucceeded: true,
			};
		},
		...options.team,
	});
	const writes: string[] = [];
	const mail = new MailService(team, {
		now: () => clock,
		sendAutomatic: async (input) => {
			const idle = store.acquireAutomaticDelivery(input.expectedAgent);
			if (!idle) return { kind: "SESSION_NOT_ACTIVE", error: "not idle" };
			const permit = await input.acquireDelivery?.();
			if (!idle.isValid() || !permit?.isValid())
				return { kind: "SESSION_NOT_ACTIVE", error: "revoked" };
			writes.push(input.text);
			return { success: true };
		},
		...options.mail,
	});
	cleanups.push(async () => {
		team.dispose();
		await mail.dispose();
		sqlite.close();
	});
	const actor = { workspaceId: "w1", terminalId: "leader-terminal" };
	const init = () =>
		team.init({ actor, name: "Team", goal: "Goal", leaderName: "leader" });
	const hook = (terminalId: string, eventType: string, sequence: number) => {
		const binding = store.get(terminalId);
		if (!binding) throw new Error("missing binding");
		store.recordEvent({
			...binding,
			eventType,
			occurredAt: clock++,
			hook: { eventType, sequence, trusted: true },
		});
	};
	const spawn = (teamId: string, extra = {}) =>
		team.spawn({
			teamId,
			name: "worker",
			agent: "config",
			prompt: "task",
			operationId: "op",
			newWorktree: false,
			...extra,
		});
	const send = (teamId: string, extra = {}) =>
		mail.send({
			teamId,
			to: "leader",
			type: "message",
			subject: "subject",
			body: "body",
			dedupeKey: "mail-1",
			...extra,
		});
	return {
		db,
		sqlite,
		store,
		team,
		mail,
		actor,
		init,
		hook,
		spawn,
		send,
		killed,
		launches,
		writes,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

function startingFixture(throwAfterCreation = false) {
	let f: ReturnType<typeof fixture>;
	f = fixture({
		team: {
			launch: async (input) => {
				f.launches.push(input.terminalId);
				f.db
					.insert(schema.terminalSessions)
					.values({
						id: input.terminalId,
						originWorkspaceId: input.workspaceId,
					})
					.run();
				if (throwAfterCreation) throw new Error("crash after PTY registration");
				return { terminalId: input.terminalId } as Awaited<
					ReturnType<typeof createTerminalSessionInternal>
				>;
			},
		},
	});
	return f;
}
const newTask = {
	operationId: "start-task",
	workspaceId: "w1",
	agent: "config",
	prompt: "  code starts indented\n    keep this indentation\n",
};
describe("atomic Team start", () => {
	test.each([
		"existing project",
		"Host session",
	])("automatic trust is restricted to Host session scaffolds for Leader and Worker: %s", async (kind) => {
		const f = fixture(),
			trusted: string[] = [];
		const project = f.db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.id, "p1"))
			.get();
		if (!project) throw Error("Missing fixture project");
		const folder = join(project.repoPath, "folder");
		mkdirSync(folder);
		writeFileSync(join(folder, "keep.txt"), "pre-existing user content");
		f.db
			.update(schema.projects)
			.set({ repoPath: folder })
			.where(eq(schema.projects.id, "p1"))
			.run();
		f.db
			.update(schema.workspaces)
			.set({
				projectId: kind === "Host session" ? null : "p1",
				worktreePath: folder,
				type: kind === "Host session" ? "session" : "local",
				branch: kind === "Host session" ? "main" : "",
			})
			.where(eq(schema.workspaces.id, "w1"))
			.run();
		f.team.deps.trust = async (_db, path) => {
			trusted.push(path);
		};
		const result = await f.team.start(newTask);
		await f.spawn(result.team.id);
		expect(trusted).toEqual(kind === "Host session" ? [folder, folder] : []);
		expect(f.launches).toHaveLength(2);
		expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe(
			"pre-existing user content",
		);
	});
	test("concurrent retries share one launch, persist intent first, and preserve the original task", async () => {
		const f = fixture();
		let release!: () => void, entered!: () => void;
		const gate = new Promise<void>((r) => {
				release = r;
			}),
			began = new Promise<void>((r) => {
				entered = r;
			});
		const original = f.team.deps.launch;
		f.team.deps.launch = async (input) => {
			const intent = f.db
				.select()
				.from(schema.teamMembers)
				.where(eq(schema.teamMembers.plannedTerminalId, input.terminalId))
				.get();
			expect(intent).toMatchObject({
				role: "leader",
				status: "spawning",
				terminalId: null,
				boundStartedAt: null,
				boundAgentSessionId: null,
				taskSummary: newTask.prompt,
			});
			expect(input.initialCommand).toMatch(/JEDV_TEAM_ROLE=[^ ]*leader/);
			entered();
			await gate;
			if (!original) throw new Error("missing test launch");
			return original(input);
		};
		const first = f.team.start(newTask);
		await began;
		const second = f.team.start(newTask);
		expect(f.db.select().from(schema.teams).all()).toHaveLength(1);
		await expect(
			f.team.start({ ...newTask, prompt: "changed" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			f.team.start({ ...newTask, workspaceId: "w2" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		release();
		const [a, b] = await Promise.all([first, second]);
		expect(a.team.id).toBe(b.team.id);
		expect(a.team.goal).toBe(newTask.prompt);
		expect(a.team.name).toBe("code starts indented");
		expect(a.members[0]?.launchState).toBe("bound");
		expect(f.launches).toHaveLength(1);
		const again = await f.team.start(newTask);
		expect(again.team.id).toBe(a.team.id);
		expect(f.launches).toHaveLength(1);
	});
	test("before the first hook, only launch-matching CLI identity is allowed and mail stays pending without PTY input", async () => {
		const f = startingFixture(),
			result = await f.team.start(newTask),
			leader = result.members[0];
		if (!leader?.terminalId || !leader.expectedLaunchId)
			throw new Error("missing leader intent");
		expect(leader.launchState).toBe("starting");
		expect(leader.boundStartedAt).toBeNull();
		expect(() =>
			f.team.resolveActor({
				workspaceId: "w1",
				terminalId: leader.terminalId ?? "",
			}),
		).toThrow();
		expect(() =>
			f.team.resolveActor({
				workspaceId: "w1",
				terminalId: leader.terminalId ?? "",
				launchId: "stale",
			}),
		).toThrow();
		const actor = {
			workspaceId: "w1",
			terminalId: leader.terminalId,
			launchId: leader.expectedLaunchId,
		};
		expect(f.team.resolveActor(actor).id).toBe(leader.id);
		const queued = f.send(result.team.id, { dedupeKey: "pre-hook" });
		await f.mail.flush();
		expect(f.writes).toHaveLength(0);
		expect(
			f.mail.inbox({ teamId: result.team.id }).items[0]?.delivery.nudgeState,
		).toBe("pending");
		f.store.recordEvent({
			terminalId: leader.terminalId,
			workspaceId: "w1",
			agentId: "claude",
			launchId: leader.expectedLaunchId,
			agentSessionId: "real-hook-session",
			eventType: "Attached",
			occurredAt: 10,
		});
		expect(
			f.team.status({ teamId: result.team.id }).members[0]?.launchState,
		).toBe("bound");
		expect(() =>
			f.team.resolveActor({ ...actor, launchId: "old-launch" }),
		).toThrow();
		f.hook(leader.terminalId, "Start", 1);
		f.hook(leader.terminalId, "Stop", 2);
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		expect(
			f.db
				.select()
				.from(schema.mailDeliveries)
				.where(eq(schema.mailDeliveries.id, queued.deliveries[0]?.id ?? ""))
				.get()?.nudgeState,
		).toBe("nudged");
	});
	test("starting session drift, exit or chat occupancy becomes reconcile_required rather than rebinding", async () => {
		for (const mismatch of ["launch", "agent", "workspace", "exit", "chat"]) {
			const f = startingFixture(),
				result = await f.team.start({
					...newTask,
					operationId: `drift-${mismatch}`,
				}),
				leader = result.members[0];
			if (!leader?.terminalId || !leader.expectedLaunchId)
				throw new Error("missing leader");
			const event = {
				terminalId: leader.terminalId,
				workspaceId: mismatch === "workspace" ? "w2" : "w1",
				agentId:
					mismatch === "agent" ? ("codex" as const) : ("claude" as const),
				launchId: mismatch === "launch" ? "old" : leader.expectedLaunchId,
				eventType: "Attached" as const,
				occurredAt: 10,
			};
			if (mismatch === "chat")
				f.store.recordChatEvent({ ...event, chatSessionId: "chat" });
			else {
				f.store.recordEvent(event);
				if (mismatch === "exit") f.store.markTerminalExited(leader.terminalId);
			}
			expect(
				f.team.status({ teamId: result.team.id }).members[0]?.launchState,
			).toBe("reconcile_required");
			expect(() =>
				f.team.resolveActor({
					workspaceId: "w1",
					terminalId: leader.terminalId ?? "",
					launchId: leader.expectedLaunchId ?? "",
				}),
			).toThrow();
		}
	});
	test("crash before PTY creation preserves task and never relaunches on retry/recovery", async () => {
		let attempts = 0;
		const f = fixture({
			team: {
				launch: async () => {
					attempts++;
					throw new Error("crash before PTY");
				},
			},
		});
		await expect(f.team.start(newTask)).rejects.toThrow("crash before PTY");
		const result = await f.team.start(newTask);
		expect(result.team.goal).toBe(newTask.prompt);
		expect(result.members[0]?.launchState).toBe("reconcile_required");
		expect(f.db.select().from(schema.terminalSessions).all()).toHaveLength(1); // original unrelated fixture leader only
		await f.team.recover();
		await f.team.start(newTask);
		expect(attempts).toBe(1);
	});
	test("crash after PTY registration adopts the planned terminal and never creates a second process", async () => {
		const f = startingFixture(true);
		await expect(f.team.start(newTask)).rejects.toThrow("crash after PTY");
		const before = await f.team.start(newTask);
		expect(before.members[0]?.launchState).toBe("reconcile_required");
		await f.team.recover();
		const after = await f.team.start(newTask);
		expect(after.members[0]?.terminalId).toBe(
			before.members[0]?.plannedTerminalId,
		);
		expect(after.members[0]?.launchState).toBe("starting");
		expect(f.launches).toHaveLength(1);
	});
	test("blank tasks, reserved init operation, invalid workspace/setup or Agent fail before intent creation", async () => {
		const f = fixture();
		await expect(
			f.team.start({ ...newTask, prompt: " \n \t" }),
		).rejects.toThrow();
		await expect(
			f.team.start({ ...newTask, operationId: "init" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			f.team.start({ ...newTask, workspaceId: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			f.team.start({ ...newTask, agent: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		f.db
			.insert(schema.workspaceSetup)
			.values({ workspaceId: "w1", status: "unknown" })
			.run();
		await expect(f.team.start(newTask)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.db.select().from(schema.teams).all()).toHaveLength(0);
		expect(f.launches).toHaveLength(0);
	});
});

describe("Team persistence and lifecycle", () => {
	test("folder project rejects a new worktree before persisting intent but permits an existing-workspace worker", async () => {
		const f = fixture();
		const project = f.db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.id, "p1"))
			.get();
		if (!project) throw new Error("missing project");
		rmSync(join(project.repoPath, ".git"), { recursive: true });
		const { team } = await f.init();
		await expect(
			f.spawn(team.id, { projectId: "p1", newWorktree: true }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.db.select().from(schema.teamMembers).all()).toHaveLength(1);
		expect(f.launches).toHaveLength(0);
		const worker = await f.spawn(team.id, { workspaceId: "w2" });
		expect(worker.status).toBe("active");
	});

	test("init is idempotent for the live leader and conflicting parameters do not create Teams", async () => {
		const f = fixture();
		const a = await f.init();
		const b = await f.init();
		expect(a.team.id).toBe(b.team.id);
		expect(
			(
				await f.team.init({
					actor: { ...f.actor, launchId: "leader-launch" },
					name: "Team",
					goal: "Goal",
					leaderName: "leader",
				})
			).team.id,
		).toBe(a.team.id);
		await expect(
			f.team.init({
				actor: f.actor,
				name: "other",
				goal: "Goal",
				leaderName: "leader",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(f.team.list("all")).toHaveLength(1);
	});
	test("concurrent spawn is idempotent, persists planned IDs before launch, and locks identity", async () => {
		const f = fixture();
		const { team } = await f.init();
		const [a, b] = await Promise.all([f.spawn(team.id), f.spawn(team.id)]);
		expect(a.id).toBe(b.id);
		expect(f.launches).toHaveLength(1);
		expect(a.terminalId).toBe(a.plannedTerminalId);
		expect(a.boundStartedAt).not.toBeNull();
		await expect(
			f.spawn(team.id, { prompt: "different" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		f.store.recordEvent({
			terminalId: a.terminalId ?? "",
			workspaceId: "w1",
			agentId: "claude",
			launchId: "replacement",
			agentSessionId: "replacement",
			eventType: "Attached",
			occurredAt: 2,
		});
		expect(f.team.member(a.id).status).toBe("reconcile_required");
		expect(f.team.binding(a)).toBeUndefined();
	});
	test("setup failure/running/unknown refuses existing-workspace spawn without side effects", async () => {
		for (const status of ["running", "failed", "unknown"] as const) {
			const f = fixture();
			const { team } = await f.init();
			f.db
				.insert(schema.workspaceSetup)
				.values({ workspaceId: "w2", status })
				.run();
			await expect(
				f.spawn(team.id, { workspaceId: "w2" }),
			).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
			expect(f.launches).toHaveLength(0);
			expect(f.team.members(team.id)).toHaveLength(1);
		}
	});
	test("new worktree intent exists before creation, setup succeeds, and the actual ID is bound", async () => {
		let f: ReturnType<typeof fixture>;
		f = fixture({
			team: {
				createWorkspace: async (input) => {
					const intent = f.db
						.select()
						.from(schema.teamMembers)
						.where(eq(schema.teamMembers.plannedWorkspaceId, input.id))
						.get();
					expect(intent?.workspaceId).toBeNull();
					expect(intent?.terminalId).toBeNull();
					f.db
						.insert(schema.workspaces)
						.values({
							id: input.id,
							projectId: "p1",
							worktreePath: "/tmp/team-new-worktree",
							branch: input.branch,
						})
						.run();
					f.db
						.insert(schema.workspaceSetup)
						.values({ workspaceId: input.id, status: "succeeded" })
						.run();
					return { workspace: { id: input.id } };
				},
			},
		});
		const { team } = await f.init();
		const member = await f.spawn(team.id, {
			projectId: "p1",
			newWorktree: true,
		});
		expect(member.workspaceId).toBe(member.plannedWorkspaceId);
		expect(member.status).toBe("active");
	});
	test("uncertain spawn is reconciled by adopting known resources and never relaunching", async () => {
		const f = fixture();
		const { team } = await f.init();
		const worker = await f.spawn(team.id);
		f.db
			.update(schema.teamMembers)
			.set({ status: "spawning", terminalId: null })
			.where(eq(schema.teamMembers.id, worker.id))
			.run();
		await f.team.recover();
		expect(f.team.member(worker.id).terminalId).toBe(worker.plannedTerminalId);
		expect(f.launches).toHaveLength(1);
		f.db
			.delete(schema.terminalSessions)
			.where(eq(schema.terminalSessions.id, worker.plannedTerminalId ?? ""))
			.run();
		f.db
			.update(schema.teamMembers)
			.set({ status: "spawning" })
			.where(eq(schema.teamMembers.id, worker.id))
			.run();
		await f.team.recover();
		expect(f.team.member(worker.id).status).toBe("reconcile_required");
		expect(f.launches).toHaveLength(1);
	});
	test("pause keeps PTYs and manual mail; stop preserves leader; archive never deletes workspaces", async () => {
		const f = fixture();
		const { team } = await f.init();
		const worker = await f.spawn(team.id);
		f.team.setPaused({ teamId: team.id }, true);
		f.send(team.id);
		await f.mail.flush();
		expect(f.killed).toHaveLength(0);
		await expect(
			f.team.archive({ teamId: team.id, stop: false }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await f.team.stop({ teamId: team.id });
		expect(f.killed).toEqual([worker.terminalId ?? ""]);
		expect(f.store.get("leader-terminal")).toBeDefined();
		await f.team.archive({ teamId: team.id, stop: false });
		expect(f.db.select().from(schema.workspaces).all()).toHaveLength(2);
	});
});

describe("Mail transactions and delivery", () => {
	test("dedupe is transactional; read and ack are independent and recipient rows remain unique", async () => {
		const f = fixture();
		const { team } = await f.init();
		const a = f.send(team.id),
			b = f.send(team.id);
		expect(a.event.id).toBe(b.event.id);
		expect(() => f.send(team.id, { body: "different" })).toThrow();
		const id = a.deliveries[0]?.id;
		if (!id) throw new Error("missing delivery");
		f.mail.consume({ actor: f.actor, deliveryId: id }, false);
		const read = f.db
			.select()
			.from(schema.mailDeliveries)
			.where(eq(schema.mailDeliveries.id, id))
			.get();
		expect(read?.readAt).not.toBeNull();
		expect(read?.ackedAt).toBeNull();
		expect(f.mail.inbox({ actor: f.actor }).items).toHaveLength(1);
		f.mail.consume({ actor: f.actor, deliveryId: id }, true);
		expect(f.mail.inbox({ actor: f.actor }).items).toHaveLength(0);
		expect(() =>
			f.db
				.insert(schema.mailDeliveries)
				.values({
					...a.deliveries[0],
					id: "duplicate",
					eventId: a.event.id,
					recipientMemberId: a.deliveries[0]?.recipientMemberId ?? "",
					nudgeState: "pending",
					createdAt: 1,
				})
				.run(),
		).toThrow();
	});
	test("busy leader waits; Stop batches pending deliveries without injecting subject or body", async () => {
		const f = fixture();
		const { team } = await f.init();
		f.hook("leader-terminal", "Start", 1);
		f.send(team.id, {
			body: "\u001b[201~\rmalicious",
			subject: "not in nudge",
		});
		f.send(team.id, { dedupeKey: "mail-2" });
		await f.mail.flush();
		expect(f.writes).toHaveLength(0);
		f.hook("leader-terminal", "Stop", 2);
		await f.mail.flush();
		expect(f.writes).toHaveLength(1);
		expect(f.writes[0]).not.toContain("malicious");
		expect(f.writes[0]).not.toContain("not in nudge");
		const rows = f.db.select().from(schema.mailDeliveries).all();
		expect(rows.map((x) => x.nudgeState)).toEqual(["nudged", "nudged"]);
		expect(rows[0]?.wakeBatchId).toBe(rows[1]?.wakeBatchId);
	});
	test("uncertain staged writes never retry and restart converts inflight to uncertain", async () => {
		const f = fixture({
			mail: {
				sendAutomatic: async (input) => {
					f.store.acquireAutomaticDelivery(input.expectedAgent);
					await input.acquireDelivery?.();
					return {
						kind: "SESSION_NOT_ACTIVE",
						error: "partial",
						inputStaged: true,
					};
				},
			},
		});
		const { team } = await f.init();
		f.hook("leader-terminal", "Start", 1);
		f.hook("leader-terminal", "Stop", 2);
		f.send(team.id);
		await f.mail.flush();
		let row = f.db.select().from(schema.mailDeliveries).get();
		expect(row?.nudgeState).toBe("uncertain_staged");
		f.hook("leader-terminal", "Start", 3);
		f.hook("leader-terminal", "Stop", 4);
		await f.mail.flush();
		row = f.db.select().from(schema.mailDeliveries).get();
		expect(row?.attemptCount).toBe(1);
		f.db
			.update(schema.mailDeliveries)
			.set({ nudgeState: "inflight", inflightToken: "crashed" })
			.run();
		const restarted = new MailService(f.team);
		expect(f.db.select().from(schema.mailDeliveries).get()?.nudgeState).toBe(
			"uncertain_staged",
		);
		await restarted.dispose();
	});
	test("hop limit is per causal chain; a fresh human task is unaffected", async () => {
		const f = fixture();
		const { team } = await f.init();
		const worker = await f.spawn(team.id);
		let previous = f.send(team.id).event;
		for (let hop = 1; hop <= 8; hop++) {
			const result = f.send(team.id, {
				actor: f.actor,
				to: worker.id,
				dedupeKey: `reply-${hop}`,
				replyTo: previous.id,
			});
			expect(result.event.hopCount).toBe(hop);
			expect(result.deliveries[0]?.nudgeState).toBe(
				hop === 8 ? "suppressed_hop_limit" : "pending",
			);
			previous = result.event;
		}
		const fresh = f.send(team.id, { dedupeKey: "independent", to: worker.id });
		expect(fresh.event.hopCount).toBe(0);
		expect(fresh.deliveries[0]?.nudgeState).toBe("pending");
	});
	test("implicit wake-batch replies inherit causality without replyTo, and human input starts a fresh task", async () => {
		const f = fixture();
		const { team } = await f.init();
		const worker = await f.spawn(team.id);
		f.hook("leader-terminal", "Start", 1);
		f.hook("leader-terminal", "Stop", 2);
		f.send(team.id);
		await f.mail.flush();
		const reply = f.send(team.id, {
			actor: f.actor,
			to: worker.id,
			dedupeKey: "implicit-reply",
		});
		expect(reply.event.hopCount).toBe(1);
		expect(reply.event.wakeBatchId).not.toBeNull();
		f.send(team.id, { dedupeKey: "new-human-task" });
		const fresh = f.send(team.id, {
			actor: f.actor,
			to: worker.id,
			dedupeKey: "fresh-task-response",
		});
		expect(fresh.event.hopCount).toBe(0);
		expect(fresh.event.wakeBatchId).toBeNull();
	});
	test("unattributed nudges use a bounded rate budget and resume after a controlled clock window", async () => {
		let timer: (() => void) | undefined;
		const f = fixture({
			mail: {
				schedule: (callback) => {
					timer = callback;
					return () => {
						timer = undefined;
					};
				},
			},
		});
		const { team } = await f.init();
		const worker = await f.spawn(team.id);
		for (let index = 0; index < 9; index++) {
			f.advance(1);
			f.hook("leader-terminal", "Start", index * 2 + 1);
			f.hook("leader-terminal", "Stop", index * 2 + 2);
			f.send(team.id, {
				actor: {
					workspaceId: worker.workspaceId,
					terminalId: worker.terminalId,
				},
				dedupeKey: `unattributed-${index}`,
			});
			await f.mail.flush();
		}
		expect(f.writes).toHaveLength(8);
		expect(
			f.db.select().from(schema.mailDeliveries).all().at(-1)?.nudgeState,
		).toBe("suppressed_budget");
		f.advance(60_001);
		timer?.();
		await f.mail.flush();
		expect(f.writes).toHaveLength(9);
	});
	test("watch returns actual new mail through an event gate without a real timeout wait", async () => {
		const f = fixture();
		const { team } = await f.init();
		const waiting = f.mail.watch({ actor: f.actor, timeoutMs: 30_000 });
		f.send(team.id);
		expect((await waiting).items).toHaveLength(1);
	});
});
