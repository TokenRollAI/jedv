import { resolveUserHomeDir } from "@jedv/agent-setup/paths";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
	mailDeliveries,
	mailEvents,
	projects,
	teamMembers,
	teams,
	terminalAgentBindings,
	workspaces,
} from "../db/schema";
import { mailReceipt } from "../mail/policy";
import { matchesAgentBinding } from "../terminal-agents/matches-agent-binding";
import type { TerminalAgentBinding } from "../terminal-agents/types";
import type { HostServiceContext } from "../types";
import {
	type AttentionLocatorOptions,
	createAttentionSourceLocator,
} from "../watchdog/host-source";
import type { WatchdogSnapshot } from "../watchdog/service";
import { MemoryRuntime } from "./runtime";

export type HostMemoryOptions = Pick<
	ConstructorParameters<typeof MemoryRuntime>[0],
	"home" | "transcriptHome" | "deepseek"
> &
	AttentionLocatorOptions & {
		clock?: ConstructorParameters<typeof MemoryRuntime>[0]["watchdog"]["clock"];
	};
export function createHostMemoryRuntime(
	ctx: HostServiceContext,
	options: HostMemoryOptions = {},
) {
	const gitActivity = new Map<string, number>();
	const now = options.clock?.now ?? Date.now;
	const runtime = new MemoryRuntime({
		db: ctx.db.$client,
		...options,
		transcriptHome: options.transcriptHome ?? resolveUserHomeDir,
		memory: {
			now,
			projectRoot(id) {
				const row = ctx.db
					.select()
					.from(projects)
					.where(eq(projects.id, id))
					.get();
				if (!row || row.deletedAt !== null)
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Project does not exist",
					});
				return row.repoPath;
			},
			isTeamArchived(id) {
				const row = ctx.db.select().from(teams).where(eq(teams.id, id)).get();
				return !row || row.status === "archived";
			},
			validateScope(scope) {
				if (scope.scopeKind === "global") return;
				const row =
					scope.scopeKind === "project"
						? ctx.db
								.select()
								.from(projects)
								.where(eq(projects.id, scope.scopeId))
								.get()
						: ctx.db
								.select()
								.from(teams)
								.where(eq(teams.id, scope.scopeId))
								.get();
				if (!row || ("deletedAt" in row && row.deletedAt !== null))
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Memory scope does not exist",
					});
			},
		},
		watchdog: {
			clock: options.clock,
			snapshot: () => readHostWatchdogSnapshot(ctx, gitActivity),
			locateSources: createAttentionSourceLocator(ctx, options),
		},
	});
	return {
		runtime,
		recordGitActivity(workspaceId: string) {
			gitActivity.set(workspaceId, now());
		},
		forgetWorkspace(workspaceId: string) {
			gitActivity.delete(workspaceId);
		},
		dispose: async () => {
			gitActivity.clear();
			await runtime.dispose();
		},
	};
}

export function readHostWatchdogSnapshot(
	ctx: HostServiceContext,
	gitActivity: ReadonlyMap<string, number>,
): WatchdogSnapshot {
	const members: WatchdogSnapshot["members"] = [];
	const rows = ctx.db
		.select({ member: teamMembers, team: teams })
		.from(teamMembers)
		.innerJoin(teams, eq(teams.id, teamMembers.teamId))
		.all();
	const workspaceById = new Map(
		ctx.db
			.select()
			.from(workspaces)
			.all()
			.map((row) => [row.id, row]),
	);
	const deliveries = ctx.db
		.select({ delivery: mailDeliveries, event: mailEvents })
		.from(mailDeliveries)
		.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
		.all();
	for (const { member, team } of rows) {
		const workspaceId = member.workspaceId ?? member.plannedWorkspaceId;
		const terminalId = member.terminalId ?? member.plannedTerminalId;
		const binding = member.terminalId
			? ctx.terminalAgentStore.get(member.terminalId)
			: undefined;
		const expected: TerminalAgentBinding = {
			terminalId: member.terminalId ?? "",
			workspaceId: member.workspaceId ?? "",
			agentId: member.agentId as TerminalAgentBinding["agentId"],
			launchId: member.expectedLaunchId ?? undefined,
			agentSessionId: member.boundAgentSessionId ?? undefined,
			startedAt: member.boundStartedAt ?? 0,
			lastEventAt: 0,
			lastEventType: "Unknown",
		};
		const known =
			!!binding &&
			member.boundStartedAt !== null &&
			matchesAgentBinding(binding, expected) &&
			!ctx.terminalAgentStore.hasChat(binding.terminalId);
		const state = known
			? ctx.terminalAgentStore.getAutomaticDeliveryState(binding)
			: "unknown";
		members.push({
			id: member.id,
			teamId: member.teamId,
			status: member.status,
			teamStatus: team.status,
			activityKnown: known,
			projectId: workspaceId
				? (workspaceById.get(workspaceId)?.projectId ?? null)
				: null,
			workspaceId,
			terminalId,
			working:
				known && (state === "working" || binding.lastEventType === "Start"),
			startedAt: known
				? binding.startedAt
				: (member.boundStartedAt ?? member.joinedAt),
			lastAgentActivityAt: known
				? binding.lastEventAt
				: (member.boundStartedAt ?? member.joinedAt),
			lastGitActivityAt: workspaceId
				? (gitActivity.get(workspaceId) ?? null)
				: null,
			permissionRequested:
				known &&
				(state === "permission" ||
					binding.lastEventType === "PermissionRequest"),
			uncertainDeliveryIds: deliveries
				.filter(
					({ delivery }) =>
						delivery.recipientMemberId === member.id &&
						delivery.ackedAt === null &&
						delivery.nudgeState === "uncertain_staged",
				)
				.map(({ delivery }) => delivery.id),
			faultKey: JSON.stringify([
				member.lastError,
				member.expectedLaunchId,
				member.boundStartedAt,
			]),
		});
	}
	const memberById = new Map(rows.map(({ member }) => [member.id, member]));
	const mail = deliveries.map(({ delivery, event }) => {
		const member = memberById.get(delivery.recipientMemberId),
			workspaceId = member?.workspaceId ?? member?.plannedWorkspaceId ?? null;
		return {
			id: delivery.id,
			teamId: event.teamId,
			createdAt: delivery.createdAt,
			ackedAt: delivery.ackedAt,
			nudgeState: delivery.nudgeState,
			nudgedAt: delivery.nudgedAt,
			attemptCount: delivery.attemptCount,
			recipientReadAt: mailReceipt(event, delivery.id)?.readAt ?? null,
			recipientMemberId: delivery.recipientMemberId,
			workspaceId,
			terminalId: member?.terminalId ?? member?.plannedTerminalId ?? null,
			projectId: workspaceId
				? (workspaceById.get(workspaceId)?.projectId ?? null)
				: null,
		};
	});
	const automations = ctx.runtime.automations;
	return {
		members,
		mail,
		automationRuns: automations
			? automations.list().flatMap((def) =>
					automations.listRuns(def.id).map((run) => ({
						id: run.id,
						automationId: run.automationId,
						status: run.status,
						createdAt: run.createdAt,
						finishedAt: run.finishedAt,
						workspaceId: run.workspaceId,
						terminalId: run.terminalId,
						projectId: run.workspaceId
							? (workspaceById.get(run.workspaceId)?.projectId ?? null)
							: null,
					})),
				)
			: [],
	};
}

// Called only after the Hook receiver has checked launch identity, token and a fresh sequence.
export async function captureTrustedMemoryHook(
	ctx: HostServiceContext,
	input: {
		terminalId: string;
		workspaceId: string;
		launchId: string;
		agentSessionId: string;
		sequence: number;
		eventType: string;
		trusted: boolean;
		transcriptPath?: string;
	},
) {
	const runtime = ctx.runtime.memory;
	if (!runtime || !input.trusted) return;
	const binding = ctx.db
		.select()
		.from(terminalAgentBindings)
		.where(eq(terminalAgentBindings.terminalId, input.terminalId))
		.get();
	if (
		!binding ||
		binding.workspaceId !== input.workspaceId ||
		binding.launchId !== input.launchId ||
		binding.agentSessionId !== input.agentSessionId ||
		!binding.transcriptPath
	)
		return;
	const identity = JSON.stringify([
		input.terminalId,
		input.launchId,
		input.agentSessionId,
	]);
	if (input.transcriptPath && input.transcriptPath === binding.transcriptPath)
		runtime.rememberTranscript(identity, input.transcriptPath);
	if (
		![
			"SessionEnd",
			"sessionEnd",
			"session_end",
			"Detached",
			"detached",
			"Interrupt",
		].includes(input.eventType) ||
		runtime.transcriptFor(identity) !== binding.transcriptPath
	)
		return;
	const workspace = ctx.db
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!workspace || workspace.archivedAt !== null) return;
	const member = ctx.db
		.select()
		.from(teamMembers)
		.where(
			and(
				eq(teamMembers.terminalId, input.terminalId),
				eq(teamMembers.expectedLaunchId, input.launchId),
				eq(teamMembers.boundAgentSessionId, input.agentSessionId),
			),
		)
		.all()
		.find((row) => ["active", "spawning"].includes(row.status));
	await runtime.enqueueExtraction(
		{
			transcriptPath: binding.transcriptPath,
			terminalId: input.terminalId,
			projectId: workspace.projectId,
			teamId: member?.teamId,
			trigger:
				input.eventType === "Interrupt" ? "human_correction" : "session_end",
		},
		`${input.terminalId}:${input.launchId}:${input.sequence}`,
	);
}
