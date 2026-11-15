import { randomUUID } from "node:crypto";
import type { ButlerTurnContext, GuardedAction } from "@jedv/shared/butler";
import { guardedActionSchema } from "@jedv/shared/butler";
import {
	memoryListSchema,
	memoryPutSchema,
	memoryReviewSchema,
	memorySearchSchema,
} from "@jedv/shared/memory";
import { TRPCError } from "@trpc/server";
import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DeepseekTool } from "../ai/deepseek";
import {
	mailEvents,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import { requireTeamwork } from "../teams/runtime";
import { workspaceRouter } from "../trpc/router/workspace/workspace";
import { workspaceCleanupRouter } from "../trpc/router/workspace-cleanup/workspace-cleanup";
import { workspacesRouter } from "../trpc/router/workspaces/workspaces";
import type { HostServiceContext } from "../types";
import { readApprovalCards } from "./approval-query";
import { digest } from "./canonical";

const id = z.string().min(1).max(128),
	limit = z.number().int().min(1).max(100).default(30),
	empty = z.object({});
export interface HumanTurn {
	threadId: string;
	requestId: string;
	humanVerbatim: string;
	context?: ButlerTurnContext;
}
const definitions = {
	getApprovals: {
		schema: z.object({
			threadId: id.optional(),
			approvalId: id.optional(),
			status: z.enum(["pending", "history", "all"]).default("all"),
			limit,
		}),
		description:
			"Read current persisted approval facts, including completed/rejected/expired cards. Read only; never approve, retry or execute them.",
		write: false,
	},
	listWorkspaces: {
		schema: z.object({ limit }),
		description: "List live Workspaces and their IDs",
		write: false,
	},
	listTeams: { schema: empty, description: "List Teams", write: false },
	getTeamStatus: {
		schema: z.object({ teamId: id }),
		description: "Read Team members, state and task status",
		write: false,
	},
	getMail: {
		schema: z.object({ teamId: id, limit }),
		description: "Read Team mail and Leader replies without acknowledging it",
		write: false,
	},
	getCronStatusAndErrors: {
		schema: empty,
		description: "Read Automations and failures",
		write: false,
	},
	searchMemory: {
		schema: memorySearchSchema,
		description: "Search scoped memory",
		write: false,
	},
	listMemories: {
		schema: memoryListSchema,
		description: "List active memory or review candidates",
		write: false,
	},
	renameTeam: {
		schema: z.object({ teamId: id, name: z.string().trim().min(1).max(120) }),
		description: "Rename Team; requires current human request",
		write: true,
	},
	renameWorkspace: {
		schema: z.object({
			workspaceId: id,
			name: z.string().trim().min(1).max(200),
		}),
		description: "Rename Workspace title only",
		write: true,
	},
	createWorkspace: {
		schema: z.object({
			projectId: id,
			name: z.string().min(1).max(200),
			branch: z.string().min(1).max(200),
		}),
		description: "Create a Worktree Workspace in an existing Git project",
		write: true,
	},
	sendMailToLeader: {
		schema: z.object({
			teamId: id,
			body: z.string().max(12000),
			subject: z.string().max(300).default(""),
		}),
		description:
			"Send supplemental mail to the specified Leader; original human text is attached by the server",
		write: true,
	},
	putMemory: {
		schema: memoryPutSchema,
		description: "Write project/team memory; global adoption requires approval",
		write: true,
	},
	reviewMemory: {
		schema: memoryReviewSchema,
		description:
			"Accept/reject project/team candidate; global adoption requires approval",
		write: true,
	},
	requestApproval: {
		schema: guardedActionSchema,
		description:
			"Propose archiveWorkspace, stopTeam, deleteMemoryBatch or acceptGlobalMemory. Never execute them directly.",
		write: true,
	},
} as const;
export const butlerToolDefinitions: DeepseekTool[] = Object.entries(
	definitions,
).map(([name, d]) => ({
	type: "function",
	function: {
		name,
		description: d.description,
		parameters: z.toJSONSchema(d.schema) as Record<string, unknown>,
	},
}));
function requireHuman(turn: HumanTurn | undefined) {
	if (!turn)
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "A current explicit human request is required for write tools",
		});
	return turn;
}
export class ButlerTools {
	constructor(
		readonly ctx: HostServiceContext,
		private readonly now: () => number = Date.now,
	) {}
	async run(name: string, raw: unknown, turn?: HumanTurn): Promise<unknown> {
		const def = definitions[name as keyof typeof definitions];
		if (!def)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Unknown Butler tool",
			});
		const input = def.schema.parse(raw);
		if (def.write) requireHuman(turn);
		switch (name) {
			case "getApprovals":
				return readApprovalCards(
					this.ctx.db.$client,
					input as Parameters<typeof readApprovalCards>[1],
					this.now(),
				);
			case "listWorkspaces":
				return this.ctx.db
					.select({
						id: workspaces.id,
						name: workspaces.name,
						projectId: workspaces.projectId,
						type: workspaces.type,
						branch: workspaces.branch,
					})
					.from(workspaces)
					.where(isNull(workspaces.archivedAt))
					.limit((input as { limit: number }).limit)
					.all();
			case "listTeams":
				return (await requireTeamwork(this.ctx)).team.list("all");
			case "getTeamStatus":
				return (await requireTeamwork(this.ctx)).team.status(
					input as { teamId: string },
				);
			case "getMail": {
				const x = input as { teamId: string; limit: number };
				(await requireTeamwork(this.ctx)).team.team(x.teamId);
				return this.ctx.db
					.select()
					.from(mailEvents)
					.where(eq(mailEvents.teamId, x.teamId))
					.orderBy(desc(mailEvents.createdAt))
					.limit(x.limit)
					.all()
					.reverse()
					.map((row) => ({
						id: row.id,
						replyToEventId: row.replyToEventId,
						sourceKind: row.sourceKind,
						sourceId: row.sourceId,
						subject: row.subject,
						body: row.body.slice(0, 4000),
						createdAt: row.createdAt,
					}));
			}
			case "getCronStatusAndErrors": {
				const service = this.ctx.runtime.automations;
				return service
					? service.list().map((def) => ({
							id: def.id,
							name: def.name,
							enabled: def.enabled,
							runs: service.listRuns(def.id).slice(-10),
						}))
					: { unavailable: true };
			}
			case "searchMemory":
				return this.memory.search(input as z.input<typeof memorySearchSchema>);
			case "listMemories":
				return this.memory.list(input as z.input<typeof memoryListSchema>);
			case "renameTeam":
				return (await requireTeamwork(this.ctx)).team.rename(
					input as { teamId: string; name: string },
				);
			case "renameWorkspace": {
				const x = input as { workspaceId: string; name: string };
				return workspaceRouter
					.createCaller(this.ctx)
					.update({ id: x.workspaceId, name: x.name });
			}
			case "createWorkspace":
				return workspacesRouter.createCaller(this.ctx).create({
					...(input as { projectId: string; name: string; branch: string }),
					id: randomUUID(),
					trackSetupCompletion: true,
					skipBranchPrefix: true,
				});
			case "sendMailToLeader": {
				const x = input as { teamId: string; body: string; subject: string };
				const human = requireHuman(turn);
				return (await requireTeamwork(this.ctx)).mail.send({
					teamId: x.teamId,
					to: "leader",
					type: "butler.message",
					subject: x.subject,
					body: x.body,
					payload: {
						humanVerbatim: human.humanVerbatim,
						butlerThreadId: human.threadId,
					},
					dedupeKey: `butler-${digest({ requestId: human.requestId, ...x }).slice(0, 48)}`,
				});
			}
			case "putMemory": {
				const x = memoryPutSchema.parse(input);
				if (x.scopeKind === "global")
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Global memory changes require an approval",
					});
				return this.memory.put({ ...x, sourceKind: "human" });
			}
			case "reviewMemory": {
				const x = memoryReviewSchema.parse(input);
				if (this.memory.get(x.id).scopeKind === "global")
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Global memory review requires an approval",
					});
				return this.memory.reviewCandidate(x);
			}
			case "requestApproval":
				return { approvalIntent: guardedActionSchema.parse(input) };
		}
	}
	private get memory() {
		const memory = this.ctx.runtime.memory?.memory;
		if (!memory)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Memory unavailable",
			});
		return memory;
	}
	snapshot(action: GuardedAction): unknown {
		switch (action.actionType) {
			case "archiveWorkspace": {
				const row = this.ctx.db
					.select()
					.from(workspaces)
					.where(eq(workspaces.id, action.workspaceId))
					.get();
				if (!row || row.archivedAt !== null)
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Workspace is unavailable or archived",
					});
				return {
					workspace: row,
					terminals: this.ctx.db
						.select()
						.from(terminalSessions)
						.where(eq(terminalSessions.originWorkspaceId, row.id))
						.all()
						.sort((a, b) => a.id.localeCompare(b.id)),
				};
			}
			case "stopTeam": {
				const team = this.ctx.db
					.select()
					.from(teams)
					.where(eq(teams.id, action.teamId))
					.get();
				if (!team || !["active", "paused"].includes(team.status))
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Team is no longer active",
					});
				const members = this.ctx.db
					.select()
					.from(teamMembers)
					.where(eq(teamMembers.teamId, action.teamId))
					.all()
					.sort((a, b) => a.id.localeCompare(b.id));
				if (
					action.member &&
					!members.some(
						(m) => m.id === action.member || m.name === action.member,
					)
				)
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Team member not found",
					});
				return { team, members };
			}
			case "deleteMemoryBatch": {
				const ids = [...new Set(action.memoryIds)].sort();
				const rows = ids.map((id) => this.memory.get(id));
				if (rows.some((r) => r.status === "removed"))
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Memory already removed",
					});
				return rows;
			}
			case "acceptGlobalMemory": {
				const candidate = this.memory.get(action.memoryId);
				if (
					candidate.scopeKind !== "global" ||
					candidate.status !== "candidate" ||
					candidate.supersededById
				)
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Global candidate is no longer pending",
					});
				const prior = action.supersedeId
					? this.memory.get(action.supersedeId)
					: null;
				if (
					prior &&
					(prior.scopeKind !== "global" ||
						prior.status !== "active" ||
						prior.supersededById)
				)
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Global supersede target changed",
					});
				return { candidate, prior };
			}
		}
	}
	async execute(action: GuardedAction) {
		switch (action.actionType) {
			case "archiveWorkspace":
				return workspaceCleanupRouter.createCaller(this.ctx).destroy({
					workspaceId: action.workspaceId,
					deleteBranch: false,
					force: false,
					skipTeardown: false,
				});
			case "stopTeam":
				return (await requireTeamwork(this.ctx)).team.stop({
					teamId: action.teamId,
					member: action.member,
				});
			case "deleteMemoryBatch":
				return this.ctx.db.transaction(() =>
					action.memoryIds.map((id) => this.memory.remove(id)),
				);
			case "acceptGlobalMemory":
				return this.memory.reviewCandidate({
					id: action.memoryId,
					action: "accept",
					supersedeId: action.supersedeId,
				});
		}
	}
}
