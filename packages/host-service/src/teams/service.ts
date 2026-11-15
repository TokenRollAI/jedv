import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	type TeamSpawnInput,
	type TeamworkActor,
	teamStartSchema,
} from "@jedv/shared/teamwork";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import {
	mailDeliveries,
	projects,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import { requireGitCapability } from "../projects/vcs-capabilities";
import { createGitEnvResolver } from "../runtime/git/git";
import {
	createTerminalSessionInternal,
	disposeSessionAndWait,
	isAgentTerminalAlive,
} from "../terminal/terminal";
import { resolveHostAgentConfig } from "../terminal-agents/agent-config";
import { matchesAgentBinding } from "../terminal-agents/matches-agent-binding";
import type { TerminalAgentBinding } from "../terminal-agents/types";
import {
	buildTerminalAgentLaunch,
	launchIdentity,
} from "../trpc/router/agents";
import { seedAgentFolderTrust } from "../trpc/router/workspace-creation/shared/seed-agent-trust";
import { getWorkspaceSetupStatus } from "../trpc/router/workspace-creation/shared/workspace-setup";
import { workspacesRouter } from "../trpc/router/workspaces/workspaces";
import type { HostServiceContext } from "../types";
import { getHostWorkerPool } from "../workers/host-worker-pool";
import { gitWorktreeListTask } from "../workers/tasks/git";

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export function fingerprint(value: unknown): string {
	const stable = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(stable)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.entries(v)
							.filter(([, x]) => x !== undefined)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([k, x]) => [k, stable(x)]),
					)
				: v;
	return createHash("sha256")
		.update(JSON.stringify(stable(value)))
		.digest("hex");
}
export function fail(
	code:
		| "NOT_FOUND"
		| "CONFLICT"
		| "PRECONDITION_FAILED"
		| "BAD_REQUEST"
		| "FORBIDDEN",
	message: string,
): never {
	throw new TRPCError({ code, message });
}

export interface TeamServiceDependencies {
	now?: () => number;
	createWorkspace?: (input: {
		projectId: string;
		id: string;
		branch: string;
		baseBranch?: string;
		name: string;
		trackSetupCompletion: boolean;
		skipBranchPrefix: boolean;
	}) => Promise<{ workspace: { id: string } }>;
	launch?: typeof createTerminalSessionInternal;
	alive?: typeof isAgentTerminalAlive;
	dispose?: typeof disposeSessionAndWait;
	worktreeRegistration?: (
		repoPath: string,
	) => ReturnType<typeof gitWorktreeListTask.handler>;
	trust?: typeof seedAgentFolderTrust;
}

export class TeamService extends EventEmitter {
	readonly now: () => number;
	private readonly starts = new Map<
		string,
		Promise<ReturnType<TeamService["status"]>>
	>();
	private readonly spawns = new Map<string, Promise<TeamMember>>();
	private readonly stoppingTeams = new Set<string>();
	private readonly removeTerminalListener: (() => void) | undefined;
	constructor(
		readonly ctx: HostServiceContext,
		readonly deps: TeamServiceDependencies = {},
	) {
		super();
		this.now = deps.now ?? Date.now;
		ctx.terminalAgentStore.on("change", this.observe);
		ctx.terminalAgentStore.on("ended", this.observeEnded);
		this.removeTerminalListener = ctx.eventBus?.onTerminalLifecycle?.(
			(event) => {
				if (event.eventType === "exit")
					ctx.terminalAgentStore.markTerminalExited(event.terminalId);
			},
		);
	}
	dispose() {
		this.ctx.terminalAgentStore.off("change", this.observe);
		this.ctx.terminalAgentStore.off("ended", this.observeEnded);
		this.removeTerminalListener?.();
	}
	changed(teamId: string) {
		this.emit("change", teamId);
		this.ctx.eventBus?.broadcastTeamChanged?.({
			teamId,
			occurredAt: this.now(),
		});
	}
	private observeEnded = (terminalId: string, launchId?: string) => {
		for (const member of this.ctx.db
			.select()
			.from(teamMembers)
			.where(
				and(
					eq(teamMembers.terminalId, terminalId),
					inArray(teamMembers.status, ["active", "spawning"]),
				),
			)
			.all()) {
			if (
				launchId &&
				member.expectedLaunchId &&
				launchId !== member.expectedLaunchId
			)
				continue;
			this.ctx.db
				.update(teamMembers)
				.set({ status: "reconcile_required", lastError: "Agent session ended" })
				.where(eq(teamMembers.id, member.id))
				.run();
			this.changed(member.teamId);
		}
	};

	private observe = () => {
		for (const row of this.ctx.db
			.select()
			.from(teamMembers)
			.where(inArray(teamMembers.status, ["spawning", "active"]))
			.all())
			this.refresh(row);
		this.emit("bindings");
	};
	team(id: string): Team {
		return (
			this.ctx.db.select().from(teams).where(eq(teams.id, id)).get() ??
			fail("NOT_FOUND", "Team not found")
		);
	}
	member(id: string): TeamMember {
		return (
			this.ctx.db
				.select()
				.from(teamMembers)
				.where(eq(teamMembers.id, id))
				.get() ?? fail("NOT_FOUND", "Team member not found")
		);
	}
	members(teamId: string) {
		return this.ctx.db
			.select()
			.from(teamMembers)
			.where(eq(teamMembers.teamId, teamId))
			.all();
	}
	expected(member: TeamMember): TerminalAgentBinding | undefined {
		if (
			!member.terminalId ||
			!member.workspaceId ||
			member.boundStartedAt === null
		)
			return undefined;
		return {
			terminalId: member.terminalId,
			workspaceId: member.workspaceId,
			agentId: member.agentId as TerminalAgentBinding["agentId"],
			definitionId: member.definitionId as TerminalAgentBinding["definitionId"],
			launchId: member.expectedLaunchId ?? undefined,
			startedAt: member.boundStartedAt,
			agentSessionId: member.boundAgentSessionId ?? undefined,
			lastEventAt: 0,
			lastEventType: "Unknown",
		};
	}
	binding(member: TeamMember): TerminalAgentBinding | undefined {
		const expected = this.expected(member);
		if (!expected || this.ctx.terminalAgentStore.hasChat(expected.terminalId))
			return undefined;
		const current = this.ctx.terminalAgentStore.get(expected.terminalId);
		return matchesAgentBinding(current, expected) ? current : undefined;
	}
	refresh(member: TeamMember): TeamMember {
		if (!member.terminalId || !member.workspaceId) return member;
		const current = this.ctx.terminalAgentStore.get(member.terminalId);

		if (!["active", "spawning"].includes(member.status)) return member;
		if (
			this.ctx.terminalAgentStore.hasChat(member.terminalId) ||
			(current &&
				(current.endedAt !== undefined ||
					current.workspaceId !== member.workspaceId ||
					current.agentId !== member.agentId ||
					(member.expectedLaunchId &&
						current.launchId &&
						current.launchId !== member.expectedLaunchId)))
		) {
			this.ctx.db
				.update(teamMembers)
				.set({
					status: "reconcile_required",
					lastError: "Agent session was replaced or detached",
				})
				.where(eq(teamMembers.id, member.id))
				.run();
			this.changed(member.teamId);
			return this.member(member.id);
		}
		if (!current) return member;
		if (member.boundStartedAt === null) {
			if (
				this.ctx.terminalAgentStore.hasChat(member.terminalId) ||
				current.workspaceId !== member.workspaceId ||
				current.agentId !== member.agentId ||
				(member.expectedLaunchId &&
					current.launchId !== member.expectedLaunchId)
			)
				return member;
			if (!current.launchId || !current.agentSessionId) return member;
			this.ctx.db
				.update(teamMembers)
				.set({
					expectedLaunchId: current.launchId,
					boundStartedAt: current.startedAt,
					boundAgentSessionId: current.agentSessionId,
					definitionId: current.definitionId ?? null,
				})
				.where(
					and(
						eq(teamMembers.id, member.id),
						eq(teamMembers.status, member.status),
					),
				)
				.run();
			this.changed(member.teamId);
			return this.member(member.id);
		}
		if (!this.binding(member) && member.status === "active") {
			this.ctx.db
				.update(teamMembers)
				.set({
					status: "reconcile_required",
					lastError: "Agent session was replaced or detached",
				})
				.where(eq(teamMembers.id, member.id))
				.run();
			this.changed(member.teamId);
			return this.member(member.id);
		}
		return member;
	}
	resolveActor(actor: TeamworkActor, teamId?: string): TeamMember {
		const candidates = this.ctx.db
			.select()
			.from(teamMembers)
			.where(
				and(
					eq(teamMembers.terminalId, actor.terminalId),
					eq(teamMembers.workspaceId, actor.workspaceId),
					eq(teamMembers.status, "active"),
					teamId ? eq(teamMembers.teamId, teamId) : undefined,
				),
			)
			.all();
		const member = candidates
			.map((row) => this.refresh(row))
			.find((row) => {
				if (
					row.status !== "active" ||
					!["active", "paused"].includes(this.team(row.teamId).status)
				)
					return false;
				if (actor.launchId && actor.launchId !== row.expectedLaunchId)
					return false;
				if (this.binding(row)) return true;
				if (
					row.boundStartedAt !== null ||
					!actor.launchId ||
					actor.launchId !== row.expectedLaunchId ||
					!row.terminalId ||
					!row.workspaceId
				)
					return false;
				const terminal = this.ctx.db
					.select()
					.from(terminalSessions)
					.where(eq(terminalSessions.id, row.terminalId))
					.get();
				const current = this.ctx.terminalAgentStore.get(row.terminalId);
				return (
					!!terminal &&
					terminal.originWorkspaceId === row.workspaceId &&
					terminal.status === "active" &&
					!terminal.disposeRequestedAt &&
					!this.ctx.terminalAgentStore.hasChat(row.terminalId) &&
					(!current ||
						(current.endedAt === undefined &&
							current.agentId === row.agentId &&
							current.workspaceId === row.workspaceId &&
							(!current.launchId || current.launchId === row.expectedLaunchId)))
				);
			});
		return (
			member ??
			fail(
				"PRECONDITION_FAILED",
				"This terminal is not a current active Team member",
			)
		);
	}
	resolve(input: { teamId?: string; actor?: TeamworkActor }): Team {
		return this.team(
			input.teamId ??
				(input.actor
					? this.resolveActor(input.actor).teamId
					: fail("BAD_REQUEST", "Pass teamId or a current terminal identity")),
		);
	}
	findMember(teamId: string, nameOrId: string): TeamMember {
		return (
			this.ctx.db
				.select()
				.from(teamMembers)
				.where(
					and(
						eq(teamMembers.teamId, teamId),
						or(eq(teamMembers.id, nameOrId), eq(teamMembers.name, nameOrId)),
					),
				)
				.get() ?? fail("NOT_FOUND", "Recipient member not found")
		);
	}
	async start(raw: z.input<typeof teamStartSchema>) {
		const input = teamStartSchema.parse(raw),
			hash = fingerprint(input);
		if (input.operationId === "init")
			fail("BAD_REQUEST", "init is reserved for existing-session promotion");
		const existing = this.ctx.db
			.select()
			.from(teamMembers)
			.where(
				and(
					eq(teamMembers.role, "leader"),
					eq(teamMembers.operationId, input.operationId),
				),
			)
			.get();
		if (existing) {
			if (existing.requestFingerprint !== hash)
				fail(
					"CONFLICT",
					"Operation ID already has different Team start parameters",
				);
			return (
				this.starts.get(existing.id) ?? this.status({ teamId: existing.teamId })
			);
		}
		this.requireReadyWorkspace(input.workspaceId);
		const config =
			resolveHostAgentConfig(this.ctx.db, input.agent) ??
			fail("NOT_FOUND", "Agent config not found");
		buildTerminalAgentLaunch(this.ctx.db, { ...input, surface: "terminal" });
		const teamId = randomUUID(),
			leaderId = randomUUID(),
			terminalId = randomUUID(),
			launchId = randomUUID(),
			now = this.now();
		const name =
			input.name ??
			Array.from(
				input.prompt
					.split(/\r?\n/)
					.find((line) => line.trim())
					?.trim() ?? "New task",
			)
				.slice(0, 48)
				.join("");
		this.ctx.db.transaction((tx) => {
			tx.insert(teams)
				.values({
					id: teamId,
					name,
					goal: input.prompt,
					status: "active",
					originWorkspaceId: input.workspaceId,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			tx.insert(teamMembers)
				.values({
					id: leaderId,
					teamId,
					name: input.leaderName,
					role: "leader",
					status: "spawning",
					operationId: input.operationId,
					requestFingerprint: hash,
					requestJson: JSON.stringify({ ...input, kind: "start" }),
					plannedWorkspaceId: input.workspaceId,
					workspaceId: input.workspaceId,
					plannedTerminalId: terminalId,
					terminalId: null,
					agentId: launchIdentity(config),
					definitionId: null,
					expectedLaunchId: launchId,
					boundStartedAt: null,
					boundAgentSessionId: null,
					taskSummary: input.prompt,
					joinedAt: now,
				})
				.run();
		});
		this.changed(teamId);
		const request = {
			...input,
			name: input.leaderName,
			newWorktree: false,
			branch: "",
		};
		const task = this.performSpawn(leaderId, request)
			.then(() => this.status({ teamId }))
			.finally(() => this.starts.delete(leaderId));
		this.starts.set(leaderId, task);
		return task;
	}

	async init(input: {
		actor: TeamworkActor;
		name: string;
		goal: string;
		leaderName: string;
	}) {
		const current = this.ctx.terminalAgentStore.get(input.actor.terminalId);
		if (
			!current ||
			current.workspaceId !== input.actor.workspaceId ||
			current.chatSessionId ||
			this.ctx.terminalAgentStore.hasChat(current.terminalId) ||
			!current.launchId ||
			(input.actor.launchId !== undefined &&
				input.actor.launchId !== current.launchId) ||
			!current.agentSessionId ||
			!(await (this.deps.alive ?? isAgentTerminalAlive)({
				...input.actor,
				db: this.ctx.db,
				eventBus: this.ctx.eventBus,
			}))
		)
			fail(
				"PRECONDITION_FAILED",
				"Team init requires a live native Agent terminal with a known launch and session",
			);
		const hash = fingerprint({
			...input,
			actor: {
				workspaceId: input.actor.workspaceId,
				terminalId: input.actor.terminalId,
			},
		});
		return this.ctx.db.transaction((tx) => {
			for (const candidate of tx
				.select()
				.from(teamMembers)
				.where(
					and(
						eq(teamMembers.terminalId, current.terminalId),
						eq(teamMembers.status, "active"),
					),
				)
				.all()) {
				if (
					!this.binding(candidate) ||
					!["active", "paused"].includes(this.team(candidate.teamId).status)
				)
					continue;
				if (
					candidate.role === "leader" &&
					candidate.requestFingerprint === hash
				)
					return this.status({ teamId: candidate.teamId });
				fail("CONFLICT", "This Agent is already bound to an active Team");
			}
			const teamId = randomUUID(),
				memberId = randomUUID(),
				now = this.now();
			tx.insert(teams)
				.values({
					id: teamId,
					name: input.name,
					goal: input.goal,
					originWorkspaceId: current.workspaceId,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			tx.insert(teamMembers)
				.values({
					id: memberId,
					teamId,
					name: input.leaderName,
					role: "leader",
					status: "active",
					operationId: "init",
					requestFingerprint: hash,
					requestJson: JSON.stringify(input),
					plannedWorkspaceId: current.workspaceId,
					workspaceId: current.workspaceId,
					plannedTerminalId: current.terminalId,
					terminalId: current.terminalId,
					agentId: current.agentId,
					definitionId: current.definitionId,
					expectedLaunchId: current.launchId,
					boundStartedAt: current.startedAt,
					boundAgentSessionId: current.agentSessionId,
					taskSummary: input.goal,
					joinedAt: now,
				})
				.run();
			this.changed(teamId);
			return this.status({ teamId });
		});
	}
	status(input: { teamId?: string; actor?: TeamworkActor }) {
		const team = this.resolve(input);
		return {
			team,
			members: this.members(team.id).map((row) => {
				const member = this.refresh(row);
				const binding = this.binding(member);
				const workspace = member.workspaceId
					? this.ctx.db
							.select()
							.from(workspaces)
							.where(eq(workspaces.id, member.workspaceId))
							.get()
					: undefined;
				const project = workspace?.projectId
					? this.ctx.db
							.select()
							.from(projects)
							.where(eq(projects.id, workspace.projectId))
							.get()
					: undefined;
				const deliveries = this.ctx.db
					.select()
					.from(mailDeliveries)
					.where(eq(mailDeliveries.recipientMemberId, member.id))
					.all();
				return {
					...member,
					launchState: (member.status === "spawning"
						? "spawning"
						: member.status === "active"
							? member.boundStartedAt === null
								? "starting"
								: "bound"
							: member.status === "stopped"
								? "stopped"
								: "reconcile_required") as
						| "spawning"
						| "starting"
						| "bound"
						| "reconcile_required"
						| "stopped",
					projectId: workspace?.projectId ?? null,
					projectName: project?.name ?? null,
					workspaceName: workspace?.name ?? null,
					unreadCount: deliveries.filter(
						(row) => row.readAt === null && row.ackedAt === null,
					).length,
					unackedCount: deliveries.filter((row) => row.ackedAt === null).length,
					binding: binding ?? null,
					deliveryState: binding
						? this.ctx.terminalAgentStore.getAutomaticDeliveryState(binding)
						: ("unknown" as const),
				};
			}),
		};
	}
	list(status: "active" | "all" = "active") {
		return this.ctx.db
			.select()
			.from(teams)
			.where(
				status === "all"
					? undefined
					: inArray(teams.status, ["active", "paused"]),
			)
			.all();
	}
	rename(input: { teamId?: string; actor?: TeamworkActor; name: string }) {
		const team = this.resolve(input);
		this.ctx.db
			.update(teams)
			.set({ name: input.name, updatedAt: this.now() })
			.where(eq(teams.id, team.id))
			.run();
		this.changed(team.id);
		return this.status({ teamId: team.id });
	}
	setPaused(
		input: { teamId?: string; actor?: TeamworkActor },
		paused: boolean,
	) {
		const team = this.resolve(input);
		if (!["active", "paused"].includes(team.status))
			fail("PRECONDITION_FAILED", "Stopped or archived Teams cannot resume");
		this.ctx.db
			.update(teams)
			.set({ status: paused ? "paused" : "active", updatedAt: this.now() })
			.where(eq(teams.id, team.id))
			.run();
		this.changed(team.id);
		return this.status({ teamId: team.id });
	}
	async spawn(input: TeamSpawnInput): Promise<TeamMember> {
		const team = this.resolve(input);
		if (team.status !== "active")
			fail("PRECONDITION_FAILED", "Team must be active to spawn");
		const hash = fingerprint({ ...input, teamId: team.id, actor: undefined });
		const existing = this.ctx.db
			.select()
			.from(teamMembers)
			.where(
				and(
					eq(teamMembers.teamId, team.id),
					or(
						eq(teamMembers.name, input.name),
						eq(teamMembers.operationId, input.operationId),
					),
				),
			)
			.get();
		if (existing) {
			if (existing.requestFingerprint !== hash)
				fail(
					"CONFLICT",
					"Member name or operation ID already has different launch parameters",
				);
			return this.spawns.get(existing.id) ?? existing;
		}
		const config =
			resolveHostAgentConfig(this.ctx.db, input.agent) ??
			fail("NOT_FOUND", "Agent config not found");
		const newWorktree =
			input.newWorktree || !!input.projectId || !!input.branch;
		const workspaceId = newWorktree
			? randomUUID()
			: (input.workspaceId ??
				input.actor?.workspaceId ??
				team.originWorkspaceId);
		if (!workspaceId) fail("BAD_REQUEST", "No target workspace");
		const origin = this.ctx.db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, team.originWorkspaceId ?? ""))
			.get();
		const projectId = input.projectId ?? origin?.projectId ?? undefined;
		if (newWorktree && !projectId)
			fail("BAD_REQUEST", "A project is required for a new worktree");
		if (newWorktree && projectId) {
			const project = this.ctx.db
				.select()
				.from(projects)
				.where(eq(projects.id, projectId))
				.get();
			if (project) requireGitCapability(project.repoPath);
		}
		if (!newWorktree) this.requireReadyWorkspace(workspaceId);
		// Validate all launch options before recording intent or creating resources.
		buildTerminalAgentLaunch(this.ctx.db, {
			...input,
			workspaceId,
			surface: "terminal",
		});
		const memberId = randomUUID(),
			terminalId = randomUUID(),
			launchId = randomUUID();
		const request = {
			...input,
			projectId,
			workspaceId,
			newWorktree,
			branch:
				input.branch ?? `team/${team.id.slice(0, 8)}/${memberId.slice(0, 8)}`,
		};
		this.ctx.db.transaction((tx) =>
			tx
				.insert(teamMembers)
				.values({
					id: memberId,
					teamId: team.id,
					name: input.name,
					role: "worker",
					status: "spawning",
					operationId: input.operationId,
					requestFingerprint: hash,
					requestJson: JSON.stringify(request),
					plannedWorkspaceId: workspaceId,
					workspaceId: newWorktree ? null : workspaceId,
					plannedTerminalId: terminalId,
					agentId: config.presetId,
					expectedLaunchId: launchId,
					taskSummary: input.prompt,
					joinedAt: this.now(),
				})
				.run(),
		);
		this.changed(team.id);
		const task = this.performSpawn(memberId, request).finally(() =>
			this.spawns.delete(memberId),
		);
		this.spawns.set(memberId, task);
		return task;
	}
	private requireReadyWorkspace(workspaceId: string) {
		const row = this.ctx.db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspaceId))
			.get();
		if (!row || row.archivedAt !== null)
			fail("NOT_FOUND", "Target workspace is absent or archived");
		const setup = getWorkspaceSetupStatus(this.ctx.db, workspaceId);
		if (setup && !["succeeded", "not-required"].includes(setup.status))
			fail(
				"PRECONDITION_FAILED",
				`Workspace setup is ${setup.status}; worker launch was refused`,
			);
		return row;
	}
	private async waitForSetup(workspaceId: string) {
		if (getWorkspaceSetupStatus(this.ctx.db, workspaceId)?.status !== "running")
			return this.requireReadyWorkspace(workspaceId);
		await new Promise<void>((resolve, reject) => {
			const finish = () => {
				if (
					getWorkspaceSetupStatus(this.ctx.db, workspaceId)?.status ===
					"running"
				)
					return;
				clearTimeout(timer);
				remove();
				resolve();
			};
			const remove = this.ctx.eventBus.onTerminalLifecycle((event) => {
				if (event.workspaceId === workspaceId) finish();
			});
			const timer = setTimeout(() => {
				remove();
				reject(
					new TRPCError({
						code: "TIMEOUT",
						message:
							"Workspace setup is still running; inspect it before reconciling spawn",
					}),
				);
			}, 300_000);
			timer.unref?.();
			finish();
		});
		return this.requireReadyWorkspace(workspaceId);
	}
	private async performSpawn(
		memberId: string,
		request: TeamSpawnInput & {
			workspaceId: string;
			newWorktree: boolean;
			branch: string;
		},
	): Promise<TeamMember> {
		const initial = this.member(memberId);
		try {
			if (request.newWorktree) {
				const create =
					this.deps.createWorkspace ??
					((input) => workspacesRouter.createCaller(this.ctx).create(input));
				const created = await create({
					projectId:
						request.projectId ?? fail("BAD_REQUEST", "Missing project"),
					id: request.workspaceId,
					branch: request.branch,
					baseBranch: request.baseBranch,
					name: request.name,
					trackSetupCompletion: true,
					skipBranchPrefix: true,
				});
				if (created.workspace.id !== request.workspaceId)
					fail(
						"CONFLICT",
						"Worktree creation resolved to an existing workspace; reconciliation required",
					);
				this.ctx.db
					.update(teamMembers)
					.set({ workspaceId: request.workspaceId })
					.where(eq(teamMembers.id, memberId))
					.run();
				await this.waitForSetup(request.workspaceId);
			}
			const targetWorkspace = this.requireReadyWorkspace(request.workspaceId);
			if (
				this.member(memberId).status !== "spawning" ||
				this.team(initial.teamId).status !== "active"
			)
				return this.member(memberId);
			if (targetWorkspace.projectId === null) {
				const config =
					resolveHostAgentConfig(this.ctx.db, request.agent) ??
					fail("NOT_FOUND", "Agent config not found");
				await (this.deps.trust ?? seedAgentFolderTrust)(
					this.ctx.db,
					targetWorkspace.worktreePath,
					config,
				);
				if (
					this.member(memberId).status !== "spawning" ||
					this.team(initial.teamId).status !== "active"
				)
					return this.member(memberId);
			}

			const memory = this.ctx.runtime.memory?.memory.injection({
				projectId: targetWorkspace.projectId,
				teamId: initial.teamId,
			}).text;
			const prompt = memory ? `${request.prompt}\n\n${memory}` : request.prompt;
			const launch = buildTerminalAgentLaunch(this.ctx.db, {
				...request,
				prompt,
				surface: "terminal",
				launchEnv: {
					JEDV_TEAM_ID: initial.teamId,
					JEDV_TEAM_MEMBER_ID: memberId,
					JEDV_TEAM_MEMBER_NAME: initial.name,
					JEDV_TEAM_ROLE: initial.role,
					JEDV_AGENT_ID: initial.agentId,
					JEDV_AGENT_LAUNCH_ID: initial.expectedLaunchId ?? "",
				},
			});
			const command = launch.fullCommand;
			const result = await (this.deps.launch ?? createTerminalSessionInternal)({
				terminalId:
					initial.plannedTerminalId ??
					fail("PRECONDITION_FAILED", "No planned terminal"),
				workspaceId: request.workspaceId,
				db: this.ctx.db,
				eventBus: this.ctx.eventBus,
				initialCommand: command,
			});
			if ("error" in result) throw new Error(String(result.error));
			if (result.terminalId !== initial.plannedTerminalId)
				fail(
					"CONFLICT",
					"Terminal launch returned an unexpected identity; reconciliation required",
				);
			if (
				this.member(memberId).status !== "spawning" ||
				["stopped", "archived"].includes(this.team(initial.teamId).status)
			) {
				await (this.deps.dispose ?? disposeSessionAndWait)(
					result.terminalId,
					this.ctx.db,
				);
				return this.member(memberId);
			}
			this.ctx.db
				.update(teamMembers)
				.set({
					terminalId: result.terminalId,
					workspaceId: request.workspaceId,
					status: "active",
				})
				.where(eq(teamMembers.id, memberId))
				.run();
			const member = this.refresh(this.member(memberId));
			this.changed(initial.teamId);
			return member;
		} catch (error) {
			if (this.member(memberId).status === "stopped")
				return this.member(memberId);
			this.ctx.db
				.update(teamMembers)
				.set({
					status: "reconcile_required",
					lastError: error instanceof Error ? error.message : String(error),
				})
				.where(eq(teamMembers.id, memberId))
				.run();
			this.changed(initial.teamId);
			throw error;
		}
	}
	async recover() {
		for (const row of this.ctx.db
			.select()
			.from(teamMembers)
			.where(inArray(teamMembers.status, ["spawning", "reconcile_required"]))
			.all()) {
			if (
				this.spawns.has(row.id) ||
				this.starts.has(row.id) ||
				!row.plannedTerminalId
			)
				continue;
			const plannedTerminalId = row.plannedTerminalId;
			const teamSnapshot = this.team(row.teamId);
			if (
				row.endedAt !== null ||
				!["active", "paused"].includes(teamSnapshot.status) ||
				this.stoppingTeams.has(row.teamId)
			)
				continue;
			const workspace = row.plannedWorkspaceId
				? this.ctx.db
						.select()
						.from(workspaces)
						.where(eq(workspaces.id, row.plannedWorkspaceId))
						.get()
				: undefined;
			const terminal = this.ctx.db
				.select()
				.from(terminalSessions)
				.where(eq(terminalSessions.id, row.plannedTerminalId))
				.get();
			const bindingIdentity = () => {
				const current = this.ctx.terminalAgentStore.get(plannedTerminalId);
				return fingerprint(
					current
						? {
								terminalId: current.terminalId,
								workspaceId: current.workspaceId,
								agentId: current.agentId,
								launchId: current.launchId,
								agentSessionId: current.agentSessionId,
								startedAt: current.startedAt,
								endedAt: current.endedAt,
								chat: this.ctx.terminalAgentStore.hasChat(current.terminalId),
							}
						: null,
				);
			};
			const bindingSnapshot = bindingIdentity();
			// Attach/rename metadata can change while a liveness probe adopts
			// this same PTY. Lifetime and disposal fields must still match.
			const terminalIdentity = (
				record: typeof terminalSessions.$inferSelect | undefined,
			) =>
				fingerprint(
					record
						? {
								id: record.id,
								originWorkspaceId: record.originWorkspaceId,
								createdAt: record.createdAt,
								status: record.status,
								endedAt: record.endedAt,
								disposeRequestedAt: record.disposeRequestedAt,
							}
						: null,
				);
			const commit = (values: Partial<typeof teamMembers.$inferInsert>) =>
				this.ctx.db.transaction((tx) => {
					if (
						this.stoppingTeams.has(row.teamId) ||
						fingerprint(this.member(row.id)) !== fingerprint(row) ||
						fingerprint(this.team(row.teamId)) !== fingerprint(teamSnapshot) ||
						bindingIdentity() !== bindingSnapshot
					)
						return false;
					const latestWorkspace = row.plannedWorkspaceId
						? tx
								.select()
								.from(workspaces)
								.where(eq(workspaces.id, row.plannedWorkspaceId))
								.get()
						: undefined;
					const latestTerminal = tx
						.select()
						.from(terminalSessions)
						.where(eq(terminalSessions.id, plannedTerminalId))
						.get();
					if (
						fingerprint(latestWorkspace ?? null) !==
							fingerprint(workspace ?? null) ||
						terminalIdentity(latestTerminal) !== terminalIdentity(terminal)
					)
						return false;
					return Boolean(
						tx
							.update(teamMembers)
							.set(values)
							.where(
								and(
									eq(teamMembers.id, row.id),
									eq(teamMembers.status, row.status),
									isNull(teamMembers.endedAt),
								),
							)
							.returning({ id: teamMembers.id })
							.get(),
					);
				});
			const currentBinding = this.ctx.terminalAgentStore.get(
				row.plannedTerminalId,
			);
			const bindingMatches =
				!currentBinding ||
				(!currentBinding.endedAt &&
					!this.ctx.terminalAgentStore.hasChat(currentBinding.terminalId) &&
					currentBinding.workspaceId === workspace?.id &&
					currentBinding.agentId === row.agentId &&
					(!row.expectedLaunchId ||
						currentBinding.launchId === row.expectedLaunchId) &&
					(row.boundStartedAt === null ||
						currentBinding.startedAt === row.boundStartedAt) &&
					(row.boundAgentSessionId === null ||
						currentBinding.agentSessionId === row.boundAgentSessionId));
			const safe =
				workspace &&
				workspace.archivedAt === null &&
				bindingMatches &&
				terminal?.originWorkspaceId === workspace.id &&
				terminal.status === "active" &&
				!terminal.disposeRequestedAt;
			if (
				safe &&
				(await (this.deps.alive ?? isAgentTerminalAlive)({
					terminalId: terminal.id,
					workspaceId: workspace.id,
					db: this.ctx.db,
					eventBus: this.ctx.eventBus,
				}))
			) {
				if (
					!commit({
						terminalId: terminal.id,
						workspaceId: workspace.id,
						status: "active",
						lastError: null,
					})
				)
					continue;
				this.refresh(this.member(row.id));
			} else {
				let evidence = "Spawn result is uncertain; no resources were recreated";
				const request = JSON.parse(row.requestJson) as {
					projectId?: string;
					branch?: string;
				};
				if (request.projectId) {
					const project = this.ctx.db
						.select()
						.from(projects)
						.where(eq(projects.id, request.projectId))
						.get();
					if (project)
						try {
							const registered = await this.readWorktreeRegistration(
								project.repoPath,
							);
							evidence += registered.some(
								(record) => record.branch === request.branch,
							)
								? "; planned Git branch has a registered worktree"
								: "; Git registration does not prove completion";
						} catch {
							evidence += "; Git registration unavailable";
						}
				}
				if (
					!commit({
						status: "reconcile_required",
						workspaceId: workspace?.id ?? row.workspaceId,
						terminalId: terminal?.id ?? row.terminalId,
						lastError: evidence,
					})
				)
					continue;
			}
			this.changed(row.teamId);
		}
	}
	private async readWorktreeRegistration(repoPath: string) {
		if (this.deps.worktreeRegistration)
			return this.deps.worktreeRegistration(repoPath);
		const gitEnv = await createGitEnvResolver(this.ctx.credentials)(repoPath);
		return getHostWorkerPool().run(
			gitWorktreeListTask,
			{ repoPath, gitEnv },
			{ timeoutMs: 15000 },
		);
	}
	async stop(input: {
		teamId?: string;
		actor?: TeamworkActor;
		member?: string;
	}) {
		const team = this.resolve(input);
		if (this.stoppingTeams.has(team.id))
			fail("CONFLICT", "Team stop is already in progress");
		const targets = input.member
			? [this.findMember(team.id, input.member)]
			: this.members(team.id);
		if (input.member && targets[0]?.role === "leader")
			fail(
				"PRECONDITION_FAILED",
				"Stop the Team to unbind its leader; its terminal will be preserved",
			);
		const workers = targets.filter(
			(row) => row.role !== "leader" && row.status !== "stopped",
		);
		this.stoppingTeams.add(team.id);
		try {
			// Fence automatic deliveries and recovery before awaiting daemon IO.
			// Confirmation, not this intent, is what grants stopped/endedAt.
			this.ctx.db.transaction((tx) => {
				for (const row of workers)
					tx.update(teamMembers)
						.set({
							status: "reconcile_required",
							lastError:
								"Stop requested; waiting for terminal close confirmation",
						})
						.where(eq(teamMembers.id, row.id))
						.run();
				if (!input.member && team.status !== "archived")
					tx.update(teams)
						.set({ status: "paused", updatedAt: this.now() })
						.where(eq(teams.id, team.id))
						.run();
			});
			this.changed(team.id);
			const failures: string[] = [];
			for (const row of workers) {
				const terminalId = row.terminalId ?? row.plannedTerminalId;
				try {
					if (terminalId) {
						const current = this.ctx.terminalAgentStore.get(terminalId);
						if (
							current &&
							((row.boundStartedAt !== null &&
								!matchesAgentBinding(current, this.expected(row) ?? current)) ||
								(row.expectedLaunchId &&
									current.launchId !== row.expectedLaunchId))
						)
							throw new Error(
								"Terminal identity changed; close was not attempted",
							);
						if (current)
							this.ctx.terminalAgentStore.invalidateAutomaticDelivery(current);
						const result = await (this.deps.dispose ?? disposeSessionAndWait)(
							terminalId,
							this.ctx.db,
						);
						if (result.daemonCloseSucceeded !== true)
							throw new Error("PTY daemon did not confirm terminal closure");
						const latest = this.ctx.terminalAgentStore.get(terminalId);
						if (
							latest &&
							((current && !matchesAgentBinding(latest, current)) ||
								(row.expectedLaunchId &&
									latest.launchId !== row.expectedLaunchId))
						)
							throw new Error(
								"Terminal identity changed while closing; reconciliation required",
							);
						this.ctx.terminalAgentStore.markTerminalDisposed(terminalId);
					}
					this.ctx.db
						.update(teamMembers)
						.set({ status: "stopped", endedAt: this.now(), lastError: null })
						.where(eq(teamMembers.id, row.id))
						.run();
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					failures.push(row.name);
					this.ctx.db
						.update(teamMembers)
						.set({
							status: "failed",
							endedAt: null,
							lastError: `Stop failed: ${reason}`,
						})
						.where(eq(teamMembers.id, row.id))
						.run();
				}
			}
			if (failures.length) {
				this.changed(team.id);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Could not confirm terminal closure for: ${failures.join(", ")}. Inspect and retry stopping these members.`,
				});
			}
			this.ctx.db.transaction((tx) => {
				for (const row of targets.filter((row) => row.role === "leader"))
					tx.update(teamMembers)
						.set({ status: "stopped", endedAt: this.now(), lastError: null })
						.where(eq(teamMembers.id, row.id))
						.run();
				if (!input.member && team.status !== "archived")
					tx.update(teams)
						.set({
							status: "stopped",
							stoppedAt: this.now(),
							updatedAt: this.now(),
						})
						.where(eq(teams.id, team.id))
						.run();
			});
			this.changed(team.id);
			return this.status({ teamId: team.id });
		} finally {
			this.stoppingTeams.delete(team.id);
		}
	}
	async archive(input: {
		teamId?: string;
		actor?: TeamworkActor;
		stop: boolean;
	}) {
		const team = this.resolve(input);
		if (input.stop && ["active", "paused"].includes(team.status))
			await this.stop({ teamId: team.id });
		if (!["stopped", "archived"].includes(this.team(team.id).status))
			fail("PRECONDITION_FAILED", "Stop this Team before archiving it");
		this.ctx.db
			.update(teams)
			.set({
				status: "archived",
				archivedAt: this.now(),
				updatedAt: this.now(),
			})
			.where(eq(teams.id, team.id))
			.run();
		this.changed(team.id);
		return this.status({ teamId: team.id });
	}
}
