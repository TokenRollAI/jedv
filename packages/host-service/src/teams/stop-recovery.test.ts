import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { butlerFixture } from "../butler/test-fixture";
import * as schema from "../db/schema";
import { TeamService, type TeamServiceDependencies } from "./service";

const deferred = <T>() => Promise.withResolvers<T>();
function fixture(deps: TeamServiceDependencies = {}) {
	const f = butlerFixture();
	f.db
		.insert(schema.projects)
		.values({ id: "project", name: "Fixture", repoPath: f.root })
		.run();
	f.db
		.insert(schema.workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			worktreePath: f.root,
			branch: "main",
		})
		.run();
	f.db
		.insert(schema.teams)
		.values({
			id: "team",
			name: "Team",
			goal: "",
			status: "active",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	const add = (id: string, role: "leader" | "worker" = "worker") => {
		const terminalId = `terminal-${id}`;
		f.db
			.insert(schema.terminalSessions)
			.values({ id: terminalId, originWorkspaceId: "workspace", createdAt: 1 })
			.run();
		f.db
			.insert(schema.teamMembers)
			.values({
				id,
				teamId: "team",
				name: id,
				role,
				status: "active",
				operationId: id,
				requestFingerprint: id,
				requestJson: "{}",
				workspaceId: "workspace",
				plannedWorkspaceId: "workspace",
				terminalId,
				plannedTerminalId: terminalId,
				agentId: "claude",
				expectedLaunchId: `launch-${id}`,
				boundStartedAt: 1,
				boundAgentSessionId: `session-${id}`,
				taskSummary: "task",
				joinedAt: 1,
			})
			.run();
		f.ctx.terminalAgentStore.recordEvent({
			terminalId,
			workspaceId: "workspace",
			agentId: "claude",
			launchId: `launch-${id}`,
			agentSessionId: `session-${id}`,
			eventType: "Attached",
			occurredAt: 1,
		});
	};
	add("leader", "leader");
	add("worker");
	const closed: string[] = [];
	const team = new TeamService(f.ctx, {
		dispose: async (terminalId) => {
			closed.push(terminalId);
			f.db
				.update(schema.terminalSessions)
				.set({ status: "disposed", endedAt: 10 })
				.where(eq(schema.terminalSessions.id, terminalId))
				.run();
			return {
				terminalId,
				daemonCloseAttempted: true,
				daemonCloseSucceeded: true,
			};
		},
		...deps,
	});
	f.ctx.runtime.teamwork = { ready: Promise.resolve(), team } as never;
	return {
		...f,
		team,
		add,
		closed,
		cleanup: async () => {
			team.dispose();
			await f.dispose();
		},
	};
}

test.each([
	"false",
	"throw",
])("stop %s preserves failed Worker binding and Leader, continues other Workers, and refuses archive", async (mode) => {
	const closed: string[] = [];
	const f = fixture({
		dispose: async (terminalId) => {
			closed.push(terminalId);
			if (terminalId === "terminal-worker") {
				if (mode === "throw") throw Error("daemon unreachable");
				return {
					terminalId,
					daemonCloseAttempted: true,
					daemonCloseSucceeded: false,
				};
			}
			return {
				terminalId,
				daemonCloseAttempted: true,
				daemonCloseSucceeded: true,
			};
		},
	});
	try {
		f.add("worker-two");
		await expect(f.team.stop({ teamId: "team" })).rejects.toThrow(
			"Could not confirm",
		);
		expect(closed).toEqual(["terminal-worker", "terminal-worker-two"]);
		expect(f.team.member("worker")).toMatchObject({
			status: "failed",
			endedAt: null,
		});
		expect(f.ctx.terminalAgentStore.get("terminal-worker")).toBeDefined();
		expect(
			f.db
				.select()
				.from(schema.terminalSessions)
				.where(eq(schema.terminalSessions.id, "terminal-worker"))
				.get()?.status,
		).toBe("active");
		expect(f.team.member("worker-two")).toMatchObject({ status: "stopped" });
		expect(f.ctx.terminalAgentStore.get("terminal-worker-two")).toBeUndefined();
		expect(f.team.team("team")).toMatchObject({
			status: "paused",
			stoppedAt: null,
		});
		expect(f.team.member("leader")).toMatchObject({
			status: "active",
			endedAt: null,
		});
		expect(f.ctx.terminalAgentStore.get("terminal-leader")).toBeDefined();
		await expect(
			f.team.archive({ teamId: "team", stop: false }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	} finally {
		await f.cleanup();
	}
});

test("failed stop approval becomes failed rather than executed, and explicit stop retry confirms completion", async () => {
	let succeed = false;
	const f = fixture({
		dispose: async (terminalId) => ({
			terminalId,
			daemonCloseAttempted: true,
			daemonCloseSucceeded: succeed,
		}),
	});
	try {
		const card = f.service.requestApproval({
			requestId: "stop-card",
			humanText: "Stop after confirmation",
			action: { actionType: "stopTeam", teamId: "team" },
		});
		expect(
			(
				await f.service.resolveApproval({
					approvalId: card.id,
					payloadHash: card.payloadHash,
					decision: "approve",
				})
			).status,
		).toBe("failed");
		expect(f.team.member("worker").endedAt).toBeNull();
		expect(f.ctx.terminalAgentStore.get("terminal-worker")).toBeDefined();
		await expect(
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		succeed = true;
		await f.team.stop({ teamId: "team" });
		expect(f.team.team("team").status).toBe("stopped");
		expect(f.team.member("worker").endedAt).not.toBeNull();
		expect(f.ctx.terminalAgentStore.get("terminal-leader")).toBeDefined();
	} finally {
		await f.cleanup();
	}
});

test.each([
	true,
	false,
])("recover liveness %s cannot overwrite a concurrent stop/archive", async (alive) => {
	const entered = deferred<void>(),
		gate = deferred<boolean>();
	const f = fixture({
		alive: async () => {
			entered.resolve();
			return gate.promise;
		},
	});
	try {
		f.db
			.update(schema.teamMembers)
			.set({ status: "reconcile_required" })
			.where(eq(schema.teamMembers.id, "worker"))
			.run();
		const recovery = f.team.recover();
		await entered.promise;
		await f.team.stop({ teamId: "team" });
		await f.team.archive({ teamId: "team", stop: false });
		gate.resolve(alive);
		await recovery;
		expect(f.team.team("team").status).toBe("archived");
		expect(f.team.member("worker")).toMatchObject({
			status: "stopped",
			lastError: null,
		});
	} finally {
		gate.resolve(false);
		await f.cleanup();
	}
});

test.each([
	"success",
	"error",
])("recover Git await %s cannot overwrite a concurrent stop/archive", async (outcome) => {
	const entered = deferred<void>(),
		gate = deferred<void>();
	const f = fixture({
		worktreeRegistration: async () => {
			entered.resolve();
			await gate.promise;
			if (outcome === "error") throw Error("Git unavailable");
			return [];
		},
	});
	try {
		f.db
			.update(schema.teamMembers)
			.set({
				status: "reconcile_required",
				requestJson: JSON.stringify({ projectId: "project", branch: "main" }),
			})
			.where(eq(schema.teamMembers.id, "worker"))
			.run();
		f.db
			.update(schema.terminalSessions)
			.set({ status: "disposed" })
			.where(eq(schema.terminalSessions.id, "terminal-worker"))
			.run();
		const recovery = f.team.recover();
		await entered.promise;
		await f.team.stop({ teamId: "team" });
		await f.team.archive({ teamId: "team", stop: false });
		gate.resolve();
		await recovery;
		expect(f.team.team("team").status).toBe("archived");
		expect(f.team.member("worker")).toMatchObject({
			status: "stopped",
			lastError: null,
		});
	} finally {
		gate.resolve();
		await f.cleanup();
	}
});

test.each([
	"binding",
	"terminal-row",
])("recover cannot adopt a replaced %s after its liveness await", async (replacement) => {
	const entered = deferred<void>(),
		gate = deferred<boolean>();
	const f = fixture({
		alive: async () => {
			entered.resolve();
			return gate.promise;
		},
	});
	try {
		f.db
			.update(schema.teamMembers)
			.set({ status: "reconcile_required" })
			.where(eq(schema.teamMembers.id, "worker"))
			.run();
		const recovery = f.team.recover();
		await entered.promise;
		if (replacement === "binding")
			f.ctx.terminalAgentStore.recordEvent({
				terminalId: "terminal-worker",
				workspaceId: "workspace",
				agentId: "claude",
				launchId: "replacement-launch",
				agentSessionId: "replacement-session",
				eventType: "Attached",
				occurredAt: 2,
			});
		else
			f.db
				.update(schema.terminalSessions)
				.set({ createdAt: 2 })
				.where(eq(schema.terminalSessions.id, "terminal-worker"))
				.run();
		gate.resolve(true);
		await recovery;
		expect(f.team.member("worker").status).toBe("reconcile_required");
		expect(f.ctx.terminalAgentStore.get("terminal-worker")).toBeDefined();
	} finally {
		gate.resolve(false);
		await f.cleanup();
	}
});

test("recover accepts same-terminal attachment and title metadata during its probe", async () => {
	const f = fixture({
		alive: async () => {
			f.db
				.update(schema.terminalSessions)
				.set({ lastAttachedAt: 20, customTitle: "Renamed while adopting" })
				.where(eq(schema.terminalSessions.id, "terminal-worker"))
				.run();
			return true;
		},
	});
	try {
		f.db
			.update(schema.teamMembers)
			.set({ status: "spawning", terminalId: null })
			.where(eq(schema.teamMembers.id, "worker"))
			.run();
		await f.team.recover();
		expect(f.team.member("worker")).toMatchObject({
			status: "active",
			terminalId: "terminal-worker",
		});
		expect(
			f.db
				.select()
				.from(schema.terminalSessions)
				.where(eq(schema.terminalSessions.id, "terminal-worker"))
				.get(),
		).toMatchObject({
			createdAt: 1,
			lastAttachedAt: 20,
			customTitle: "Renamed while adopting",
		});
	} finally {
		await f.cleanup();
	}
});

test("stop fences recovery while close is pending and does not auto-recover a failed stop", async () => {
	const entered = deferred<void>(),
		gate = deferred<boolean>();
	let probes = 0;
	const f = fixture({
		dispose: async (terminalId) => {
			entered.resolve();
			return {
				terminalId,
				daemonCloseAttempted: true,
				daemonCloseSucceeded: await gate.promise,
			};
		},
		alive: async () => {
			probes++;
			return true;
		},
	});
	try {
		const stopping = f.team.stop({ teamId: "team" });
		const outcome = stopping.then(
			() => ({ error: null }),
			(error: unknown) => ({ error }),
		);
		await entered.promise;
		await f.team.recover();
		expect(probes).toBe(0);
		await expect(f.team.stop({ teamId: "team" })).rejects.toMatchObject({
			code: "CONFLICT",
		});
		gate.resolve(false);
		expect((await outcome).error).toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
		await f.team.recover();
		expect(probes).toBe(0);
		expect(f.team.member("worker")).toMatchObject({
			status: "failed",
			endedAt: null,
		});
		expect(f.ctx.terminalAgentStore.get("terminal-worker")).toBeDefined();
	} finally {
		gate.resolve(false);
		await f.cleanup();
	}
});
