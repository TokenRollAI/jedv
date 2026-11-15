import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	rmSync,
	rmdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup";
import { eq } from "drizzle-orm";
import {
	mailDeliveries,
	projects,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import { MailService } from "../mail/service";
import { networkFixture } from "../peers/test-fixture";
import { readSourceSequenceWatermark } from "./source-sequence";
import { TerminalAgentStore } from "./store";
import type { TerminalAgentBinding } from "./types";

function fixture() {
	const terminalId = randomUUID(),
		launchId = randomUUID(),
		directory = join(resolveAppHomeDir(), "state/hook-sequences");
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${terminalId}.${launchId}`),
		identity = {
			terminalId,
			launchId,
			workspaceId: "workspace",
			agentId: "claude" as const,
			agentSessionId: "session",
		};
	writeFileSync(path, "2\n");
	const store = new TerminalAgentStore();
	store.recordEvent({ ...identity, eventType: "Attached", occurredAt: 1 });
	const hook = (eventType: string, sequence: number) =>
		store.recordEvent({
			...identity,
			eventType,
			occurredAt: 100 + sequence,
			hook: { eventType, sequence, trusted: true },
		});
	hook("Start", 1);
	hook("Stop", 2);
	const binding = store.get(terminalId)!;
	return {
		store,
		binding,
		hook,
		path,
		cleanup() {
			rmSync(path, { force: true });
			rmSync(path + ".target", { force: true });
			rmSync(path + ".lock", { recursive: true, force: true });
		},
	};
}
for (const action of ["manual", "clear"] as const)
	test(`${action} snapshots producer 4, rejects queued Start3/Stop4 and admits the next trusted 5/6`, () => {
		const f = fixture();
		try {
			const oldPermit = f.store.acquireAutomaticDelivery(f.binding);
			expect(oldPermit?.isValid()).toBe(true);
			writeFileSync(f.path, "4\n");
			if (action === "manual") f.store.invalidateAutomaticDelivery(f.binding);
			else f.store.clearWorkspaceStatuses(f.binding.workspaceId);
			expect(oldPermit?.isValid()).toBe(false);
			expect(f.store.get(f.binding.terminalId)?.deliverySequence).toBe(4);
			f.hook("Start", 3);
			f.hook("Stop", 4);
			expect(f.store.getAutomaticDeliveryState(f.binding)).toBe(
				action === "clear" ? "cleared" : "unknown",
			);
			expect(f.store.acquireAutomaticDelivery(f.binding)).toBeNull();
			writeFileSync(f.path, "6\n");
			f.hook("Start", 5);
			f.hook("Stop", 6);
			expect(f.store.acquireAutomaticDelivery(f.binding)?.isValid()).toBe(true);
		} finally {
			f.cleanup();
		}
	});
for (const failure of [
	"missing",
	"malformed",
	"oversized",
	"symlink",
	"locked",
] as const)
	test(`manual barrier fails closed on ${failure} and requires a post-recovery complete cycle`, () => {
		const f = fixture();
		try {
			const oldPermit = f.store.acquireAutomaticDelivery(f.binding);
			if (failure === "missing") rmSync(f.path);
			else if (failure === "malformed") writeFileSync(f.path, "4\n5\n");
			else if (failure === "oversized") writeFileSync(f.path, "9".repeat(100));
			else if (failure === "symlink") {
				rmSync(f.path);
				writeFileSync(f.path + ".target", "4\n");
				symlinkSync(f.path + ".target", f.path);
			} else mkdirSync(f.path + ".lock");
			f.store.invalidateAutomaticDelivery(f.binding);
			expect(oldPermit?.isValid()).toBe(false);
			f.hook("Start", 3);
			f.hook("Stop", 4);
			expect(f.store.acquireAutomaticDelivery(f.binding)).toBeNull();
			if (failure === "locked") rmdirSync(f.path + ".lock");
			if (failure === "symlink") rmSync(f.path);
			writeFileSync(f.path, "6\n");
			f.hook("Start", 5);
			f.hook("Stop", 6);
			expect(f.store.acquireAutomaticDelivery(f.binding)).toBeNull();
			writeFileSync(f.path, "8\n");
			f.hook("Start", 7);
			f.hook("Stop", 8);
			expect(f.store.acquireAutomaticDelivery(f.binding)?.isValid()).toBe(true);
		} finally {
			f.cleanup();
		}
	});
test("manual barrier persists its watermark, restart restores no permission and failed restore sampling remains closed", () => {
	const f = fixture();
	let row: TerminalAgentBinding | undefined;
	try {
		const persistence = {
			load: () => (row ? [row] : []),
			upsert: (binding: TerminalAgentBinding) => {
				row = { ...binding };
			},
			delete: () => {
				row = undefined;
			},
		};
		const store = new TerminalAgentStore(persistence);
		store.recordEvent({ ...f.binding, eventType: "Attached", occurredAt: 1 });
		for (const [eventType, sequence] of [
			["Start", 1],
			["Stop", 2],
		] as const)
			store.recordEvent({
				...f.binding,
				eventType,
				occurredAt: sequence,
				hook: { eventType, sequence, trusted: true },
			});
		writeFileSync(f.path, "4\n");
		store.invalidateAutomaticDelivery(store.get(f.binding.terminalId)!);
		expect(row?.deliverySequence).toBe(4);
		const restored = new TerminalAgentStore(persistence, {
			readSourceSequence: () => null,
		});
		const hook = (eventType: string, sequence: number) =>
			restored.recordEvent({
				...f.binding,
				eventType,
				occurredAt: 100 + sequence,
				hook: { eventType, sequence, trusted: true },
			});
		hook("Start", 3);
		hook("Stop", 4);
		hook("Start", 5);
		hook("Stop", 6);
		expect(restored.acquireAutomaticDelivery(f.binding)).toBeNull();
		const next = new TerminalAgentStore(persistence);
		writeFileSync(f.path, "8\n");
		for (const [eventType, sequence] of [
			["Start", 7],
			["Stop", 8],
		] as const)
			next.recordEvent({
				...f.binding,
				eventType,
				occurredAt: 100 + sequence,
				hook: { eventType, sequence, trusted: true },
			});
		expect(next.acquireAutomaticDelivery(f.binding)?.isValid()).toBe(true);
	} finally {
		f.cleanup();
	}
});
test("source reader is same-launch, bounded and never waits on another allocator lock", () => {
	const f = fixture();
	try {
		writeFileSync(f.path, "4\n");
		expect(
			readSourceSequenceWatermark(f.binding.terminalId, f.binding.launchId),
		).toBe(4);
		expect(
			readSourceSequenceWatermark("../escape", f.binding.launchId),
		).toBeNull();
		expect(readSourceSequenceWatermark(f.binding.terminalId, "")).toBeNull();
		mkdirSync(f.path + ".lock");
		expect(
			readSourceSequenceWatermark(f.binding.terminalId, f.binding.launchId),
		).toBeNull();
		rmdirSync(f.path + ".lock");
		expect(
			readSourceSequenceWatermark(f.binding.terminalId, f.binding.launchId),
		).toBe(4);
	} finally {
		f.cleanup();
	}
});
test("pending Mail never writes after human draft and late pre-draft hooks; a genuinely fresh cycle can deliver", async () => {
	const f = networkFixture();
	await f.mail.dispose();
	let producer = 2,
		writes = 0;
	const store = new TerminalAgentStore(undefined, {
		readSourceSequence: () => producer,
	});
	f.ctx.terminalAgentStore = store;
	const identity = {
		terminalId: "draft-terminal",
		workspaceId: "draft-workspace",
		agentId: "claude" as const,
		launchId: "draft-launch",
		agentSessionId: "draft-session",
	};
	f.db
		.insert(projects)
		.values({ id: "draft-project", name: "P", repoPath: f.root })
		.run();
	f.db
		.insert(workspaces)
		.values({
			id: identity.workspaceId,
			projectId: "draft-project",
			worktreePath: f.root,
			branch: "main",
		})
		.run();
	f.db
		.insert(terminalSessions)
		.values({
			id: identity.terminalId,
			originWorkspaceId: identity.workspaceId,
		})
		.run();
	store.recordEvent({ ...identity, eventType: "Attached", occurredAt: 1 });
	const expected = store.get(identity.terminalId)!;
	f.db
		.update(teams)
		.set({ status: "active" })
		.where(eq(teams.id, f.teamId))
		.run();
	f.db
		.update(teamMembers)
		.set({
			terminalId: identity.terminalId,
			workspaceId: identity.workspaceId,
			expectedLaunchId: identity.launchId,
			boundAgentSessionId: identity.agentSessionId,
			boundStartedAt: 1,
		})
		.where(eq(teamMembers.id, f.memberId))
		.run();
	const mail = new MailService(f.team, {
		now: f.clock.now,
		schedule: f.clock.schedule,
		sendAutomatic: async (input) => {
			const idle = store.acquireAutomaticDelivery(input.expectedAgent),
				delivery = await input.acquireDelivery?.();
			if (!idle?.isValid() || !delivery?.isValid())
				return { kind: "SESSION_NOT_ACTIVE", error: "revoked" };
			writes++;
			return { success: true };
		},
	});
	const hook = (eventType: string, sequence: number) =>
		store.recordEvent({
			...identity,
			eventType,
			occurredAt: 100 + sequence,
			hook: { eventType, sequence, trusted: true },
		});
	try {
		hook("Start", 1);
		hook("Stop", 2);
		producer = 4;
		store.invalidateAutomaticDelivery(expected);
		hook("Start", 3);
		hook("Stop", 4);
		mail.send({
			teamId: f.teamId,
			to: "leader",
			type: "agent.message",
			subject: "",
			body: "Must not submit the human draft",
			dedupeKey: "manual-barrier-mail",
		});
		await mail.flush();
		expect(writes).toBe(0);
		expect(f.db.select().from(mailDeliveries).get()?.nudgeState).toBe(
			"pending",
		);
		expect(f.db.select().from(mailDeliveries).get()?.ackedAt).toBeNull();
		producer = 6;
		hook("Start", 5);
		hook("Stop", 6);
		mail.start();
		await mail.flush();
		expect(writes).toBe(1);
		expect(f.db.select().from(mailDeliveries).get()?.ackedAt).toBeNull();
	} finally {
		await mail.dispose();
		await f.dispose();
	}
});

test("a local cutoff belongs only to its launch and is not inherited by a replacement producer", () => {
	const f = fixture();
	try {
		writeFileSync(f.path, "100\n");
		f.store.invalidateAutomaticDelivery(f.binding);
		const replacement = {
			...f.binding,
			launchId: "new-launch",
			agentSessionId: "new-session",
		};
		for (const [eventType, sequence] of [
			["Start", 1],
			["Stop", 2],
		] as const)
			f.store.recordEvent({
				...replacement,
				eventType,
				occurredAt: 200 + sequence,
				hook: { eventType, sequence, trusted: true },
			});
		const current = f.store.get(f.binding.terminalId)!;
		expect(current.deliverySequence).toBe(2);
		expect(f.store.acquireAutomaticDelivery(current)?.isValid()).toBe(true);
		expect(f.store.acquireAutomaticDelivery(f.binding)).toBeNull();
	} finally {
		f.cleanup();
	}
});
