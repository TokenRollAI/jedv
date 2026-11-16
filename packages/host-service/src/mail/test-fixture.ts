import { eq } from "drizzle-orm";
import { teamMembers, teams, terminalSessions, workspaces } from "../db/schema";
import { networkFixture } from "../peers/test-fixture";
import { TeamService } from "../teams/service";
import { TerminalAgentStore } from "../terminal-agents/store";
import { type MailDependencies, MailService } from "./service";

export function mailFixture(deps: MailDependencies = {}) {
	const f = networkFixture();
	let sequence = 0;
	const store = new TerminalAgentStore(undefined, {
		readSourceSequence: () => sequence,
	});
	const ctx = { ...f.ctx, terminalAgentStore: store };
	const terminalId = "mail-fixture-terminal",
		workspaceId = "mail-fixture-workspace",
		launchId = "mail-fixture-launch";
	f.db
		.insert(workspaces)
		.values({ id: workspaceId, worktreePath: f.root, branch: "main" })
		.run();
	f.db
		.insert(terminalSessions)
		.values({ id: terminalId, originWorkspaceId: workspaceId })
		.run();
	f.db
		.update(teams)
		.set({ status: "active" })
		.where(eq(teams.id, f.teamId))
		.run();
	f.db
		.update(teamMembers)
		.set({
			workspaceId,
			terminalId,
			plannedWorkspaceId: workspaceId,
			plannedTerminalId: terminalId,
			expectedLaunchId: launchId,
			boundAgentSessionId: "native-fixture",
			boundStartedAt: 1,
			agentId: "codex",
		})
		.where(eq(teamMembers.id, f.memberId))
		.run();
	store.recordEvent({
		terminalId,
		workspaceId,
		launchId,
		agentSessionId: "native-fixture",
		agentId: "codex",
		eventType: "Attached",
		occurredAt: 1,
	});
	const team = new TeamService(ctx, {
		now: f.clock.now,
		alive: async () => true,
	});
	const writes: string[] = [];
	const mail = new MailService(team, {
		now: f.clock.now,
		schedule: f.clock.schedule,
		sendAutomatic: async (input) => {
			const permit = store.acquireAutomaticDelivery(input.expectedAgent);
			if (!permit)
				return { kind: "SESSION_NOT_ACTIVE", error: "No idle permit" };
			const delivery = await input.acquireDelivery?.();
			if (!permit.isValid() || !delivery?.isValid())
				return { kind: "SESSION_NOT_ACTIVE", error: "Revoked" };
			writes.push(input.text);
			return { success: true };
		},
		...deps,
	});
	const hook = (eventType: string, raw = eventType) => {
		sequence++;
		const binding = store.get(terminalId);
		if (!binding) throw new Error("Expected the isolated native binding");
		store.recordEvent({
			...binding,
			eventType,
			occurredAt: f.clock.now() + sequence,
			hook: { eventType: raw, sequence, trusted: true },
		});
	};
	return {
		...f,
		ctx,
		store,
		team,
		mail,
		writes,
		hook,
		actor: { workspaceId, terminalId, launchId },
		send: (key: string, extra = {}) =>
			mail.send({
				teamId: f.teamId,
				to: "leader",
				type: "message",
				subject: "",
				body: "isolated task",
				dedupeKey: key,
				...extra,
			}),
		async dispose() {
			await mail.dispose();
			team.dispose();
			await f.dispose();
		},
	};
}

export function firstDelivery<T>(result: { deliveries: T[] }): T {
	const delivery = result.deliveries[0];
	if (!delivery) throw new Error("Expected an isolated Mail delivery");
	return delivery;
}
