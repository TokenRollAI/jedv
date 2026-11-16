import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { butlerFixture } from "../butler/test-fixture";
import * as schema from "../db/schema";
import { registerTeamworkHttp } from "./http";
import { TeamService, type TeamServiceDependencies } from "./service";

function fixture(deps: TeamServiceDependencies = {}) {
	const f = butlerFixture();
	f.sqlite.exec("PRAGMA foreign_keys = ON");
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
function seedOwnedData(f: ReturnType<typeof fixture>) {
	f.db
		.insert(schema.teams)
		.values({
			id: "other",
			name: "Other",
			goal: "",
			status: "active",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	f.db
		.insert(schema.mailEvents)
		.values({
			id: "mail",
			teamId: "team",
			threadId: "mail",
			type: "message",
			sourceKind: "human",
			sourceId: "human",
			dedupeKey: "mail",
			requestFingerprint: "mail",
			hopCount: 0,
			subject: "",
			body: "secret",
			createdAt: 1,
		})
		.run();
	f.db
		.insert(schema.mailDeliveries)
		.values({
			id: "delivery",
			eventId: "mail",
			recipientMemberId: "worker",
			nudgeState: "pending",
			createdAt: 1,
		})
		.run();
	f.db
		.insert(schema.mailProviderTokens)
		.values({
			id: "token",
			name: "token",
			teamId: "team",
			allowedTo: "leader",
			typePrefix: "test",
			tokenHash: "hash",
			tokenHint: "hint",
			createdAt: 1,
		})
		.run();
	f.db
		.insert(schema.peerHosts)
		.values({
			id: "peer",
			name: "Peer",
			origin: "http://peer.invalid",
			inboundTokenHash: "hash",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	f.db
		.insert(schema.mailOutbox)
		.values({
			id: "outbox",
			eventId: "mail",
			targetPeerId: "peer",
			remoteTeamId: "remote",
			remoteTo: "leader",
			envelopeJson: "{}",
			status: "pending",
			nextAttemptAt: 1,
			createdAt: 1,
		})
		.run();
	f.db
		.insert(schema.mailInboundReceipts)
		.values({
			sourceNamespace: "peer",
			sourceEventId: "remote-mail",
			requestFingerprint: "hash",
			localEventId: "mail",
			receivedAt: 1,
		})
		.run();
	for (const scopeId of ["team", "other"]) {
		f.db
			.insert(schema.memories)
			.values({
				id: `memory-${scopeId}`,
				scopeKind: "team",
				scopeId,
				tier: "core",
				category: "fact",
				title: "Fact",
				content: "Memory",
				sourceKind: "human",
				status: "active",
				contentHash: scopeId,
				searchTokens: scopeId,
				createdAt: 1,
				updatedAt: 1,
			})
			.run();
		f.db
			.insert(schema.watchdogAlerts)
			.values({
				id: `alert-${scopeId}`,
				dedupeKey: scopeId,
				kind: "test",
				subject: "test",
				body: "test",
				teamId: scopeId,
				createdAt: 1,
			})
			.run();
	}
}

test("delete closes owned agents and removes team records, preserving other teams and shared workspaces", async () => {
	const f = fixture();
	try {
		seedOwnedData(f);
		await f.team.delete({ teamId: "team" });
		expect(f.closed).toEqual(["terminal-worker", "terminal-leader"]);
		for (const table of [
			"team_members",
			"mail_events",
			"mail_deliveries",
			"mail_provider_tokens",
			"mail_outbox",
			"mail_inbound_receipts",
		])
			expect(
				f.sqlite.query(`SELECT count(*) AS count FROM ${table}`).get(),
			).toEqual({ count: 0 });
		expect(f.team.list("all").map((team) => team.id)).toEqual(["other"]);
		expect(
			f.db
				.select()
				.from(schema.memories)
				.all()
				.map((row) => row.scopeId),
		).toEqual(["other"]);
		expect(
			f.db
				.select()
				.from(schema.watchdogAlerts)
				.all()
				.map((row) => row.teamId),
		).toEqual(["other"]);
		expect(f.db.select().from(schema.workspaces).all()).toHaveLength(1);
		expect(f.db.select().from(schema.projects).all()).toHaveLength(1);
		expect(f.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		await f.cleanup();
	}
});

test("delete keeps a promoted existing leader terminal", async () => {
	const f = fixture();
	try {
		f.db
			.update(schema.teamMembers)
			.set({ operationId: "init" })
			.where(eq(schema.teamMembers.id, "leader"))
			.run();
		await f.team.delete({ teamId: "team" });
		expect(f.closed).toEqual(["terminal-worker"]);
		expect(f.ctx.terminalAgentStore.get("terminal-leader")).toBeDefined();
	} finally {
		await f.cleanup();
	}
});

test("failed worker closure preserves team mail and memory for explicit retry", async () => {
	let fail = true;
	const f = fixture({
		dispose: async (terminalId) => ({
			terminalId,
			daemonCloseAttempted: true,
			daemonCloseSucceeded: !fail,
		}),
	});
	try {
		seedOwnedData(f);
		await expect(f.team.delete({ teamId: "team" })).rejects.toThrow(
			"Could not confirm",
		);
		expect(f.team.team("team").status).toBe("paused");
		expect(f.db.select().from(schema.mailEvents).all()).toHaveLength(1);
		expect(f.db.select().from(schema.memories).all()).toHaveLength(2);
		fail = false;
		await f.team.delete({ teamId: "team" });
		expect(f.team.list("all").map((team) => team.id)).toEqual(["other"]);
	} finally {
		await f.cleanup();
	}
});

test("inflight mail prevents record deletion until delivery settles", async () => {
	const f = fixture();
	try {
		seedOwnedData(f);
		f.db
			.update(schema.mailDeliveries)
			.set({ inflightToken: "inflight", nudgeState: "inflight" })
			.where(eq(schema.mailDeliveries.id, "delivery"))
			.run();
		await expect(f.team.delete({ teamId: "team" })).rejects.toThrow(
			"Mail delivery is still in progress",
		);
		expect(f.db.select().from(schema.mailEvents).all()).toHaveLength(1);
		f.db
			.update(schema.mailDeliveries)
			.set({ inflightToken: null, nudgeState: "nudged" })
			.where(eq(schema.mailDeliveries.id, "delivery"))
			.run();
		await f.team.delete({ teamId: "team" });
		expect(f.db.select().from(schema.mailEvents).all()).toHaveLength(0);
	} finally {
		await f.cleanup();
	}
});

test("changed leader identity is preserved and prevents deletion", async () => {
	const f = fixture();
	try {
		seedOwnedData(f);
		f.ctx.terminalAgentStore.markTerminalDisposed("terminal-leader");
		f.ctx.terminalAgentStore.recordEvent({
			terminalId: "terminal-leader",
			workspaceId: "workspace",
			agentId: "claude",
			launchId: "replacement",
			agentSessionId: "replacement-session",
			eventType: "Attached",
			occurredAt: 2,
		});
		await expect(f.team.delete({ teamId: "team" })).rejects.toThrow(
			"Leader terminal identity changed",
		);
		expect(f.closed).toEqual(["terminal-worker"]);
		expect(f.ctx.terminalAgentStore.get("terminal-leader")?.launchId).toBe(
			"replacement",
		);
		expect(f.db.select().from(schema.mailEvents).all()).toHaveLength(1);
	} finally {
		await f.cleanup();
	}
});

test("deletion refuses shared terminal ownership before stopping anything", async () => {
	const f = fixture();
	try {
		seedOwnedData(f);
		const worker = f.team.member("worker");
		f.db
			.insert(schema.teamMembers)
			.values({
				...worker,
				id: "shared",
				teamId: "other",
				name: "shared",
				operationId: "shared",
			})
			.run();
		await expect(f.team.delete({ teamId: "team" })).rejects.toThrow(
			"belongs to another team",
		);
		expect(f.closed).toEqual([]);
		expect(f.team.team("team").status).toBe("active");
	} finally {
		await f.cleanup();
	}
});

test("leader close failure keeps the stopped team and records for retry", async () => {
	let failLeader = true;
	const f = fixture({
		dispose: async (terminalId) => ({
			terminalId,
			daemonCloseAttempted: true,
			daemonCloseSucceeded: terminalId !== "terminal-leader" || !failLeader,
		}),
	});
	try {
		seedOwnedData(f);
		await expect(f.team.delete({ teamId: "team" })).rejects.toThrow(
			"Could not confirm leader",
		);
		expect(f.team.team("team").status).toBe("stopped");
		expect(f.db.select().from(schema.mailEvents).all()).toHaveLength(1);
		failLeader = false;
		await f.team.delete({ teamId: "team" });
		expect(f.db.select().from(schema.mailEvents).all()).toHaveLength(0);
	} finally {
		await f.cleanup();
	}
});

test("HTTP archive and delete dispatch their own handlers and delete rejects missing targets", async () => {
	const f = fixture();
	try {
		const app = new Hono();
		registerTeamworkHttp({ app, context: f.ctx, authenticate: () => true });
		const post = (path: string, body: unknown) =>
			app.request(`/api/v1/teams/${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		const archived = await post("archive", { teamId: "team", stop: true });
		expect(archived.status).toBe(200);
		expect(f.team.team("team").status).toBe("archived");
		const invalid = await post("delete", {});
		expect(invalid.status).toBe(400);
		const deleted = await post("delete", { teamId: "team" });
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ deleted: true, teamId: "team" });
		expect(f.team.list("all")).toEqual([]);
	} finally {
		await f.cleanup();
	}
});
