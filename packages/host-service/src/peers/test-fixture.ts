import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { MailService } from "../mail/service";
import { MobileAuthService } from "../mobile/service";
import { DeclarativeSlotService } from "../slots/service";
import { TeamService } from "../teams/service";
import { TerminalAgentStore } from "../terminal-agents/store";
import type { HostServiceContext } from "../types";
import type { PeerClock } from "./outbox-forwarder";
import { PeerService } from "./service";
export function controlledClock() {
	let now = 1_000_000,
		id = 0;
	const timers = new Map<number, { at: number; callback: () => void }>();
	const clock: PeerClock = {
		now: () => now,
		schedule(callback, delay) {
			const key = ++id;
			timers.set(key, { at: now + delay, callback });
			return () => {
				timers.delete(key);
			};
		},
	};
	return {
		clock,
		advance(ms: number) {
			now += ms;
			for (const [key, t] of [...timers])
				if (t.at <= now) {
					timers.delete(key);
					t.callback();
				}
		},
		timers,
	};
}
export function networkFixture() {
	const root = mkdtempSync(join(tmpdir(), "jedv-network-unit-"));
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	migrate(db as never, {
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
	});
	sqlite.exec("PRAGMA foreign_keys=ON");
	const clock = controlledClock();
	const teamId = randomUUID(),
		memberId = randomUUID();
	db.insert(schema.teams)
		.values({
			id: teamId,
			name: "Network Team",
			goal: "test",
			status: "paused",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	db.insert(schema.teamMembers)
		.values({
			id: memberId,
			teamId,
			name: "leader",
			role: "leader",
			status: "active",
			agentId: "claude",
			operationId: "init",
			requestFingerprint: "test",
			requestJson: "{}",
			taskSummary: "test",
			joinedAt: 1,
		})
		.run();
	const ctx = {
		db,
		terminalAgentStore: new TerminalAgentStore(),
		runtime: {},
		userId: "human",
		eventBus: {
			broadcastMailChanged: () => {},
			broadcastTeamChanged: () => {},
		},
	} as unknown as HostServiceContext;
	const team = new TeamService(ctx, {
		now: clock.clock.now,
		alive: async () => false,
	});
	const mail = new MailService(team, {
		now: clock.clock.now,
		schedule: clock.clock.schedule,
	});
	const peers = new PeerService(mail, {
		home: root,
		localHostId: "host-a",
		now: clock.clock.now,
		isManagementToken: (raw) =>
			raw === "management-token-must-not-be-used-as-peer",
	});
	mail.peers = peers;
	const mobile = new MobileAuthService(sqlite, clock.clock.now),
		slots = new DeclarativeSlotService(peers, root);
	return {
		root,
		sqlite,
		db,
		ctx,
		team,
		mail,
		peers,
		mobile,
		slots,
		teamId,
		memberId,
		...clock,
		async dispose() {
			await mail.dispose();
			team.dispose();
			sqlite.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
