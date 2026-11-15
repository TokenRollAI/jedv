import { createHash, randomUUID } from "node:crypto";
import {
	type MemoryItemShape,
	type MemoryScope,
	memoryListSchema,
	memoryPutSchema,
	memoryReviewSchema,
	memoryScopeSchema,
	memorySearchSchema,
	memoryTransferSchema,
} from "@jedv/shared/memory";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { readProjectMemory, writeProjectMemory } from "./files";
import { atomic, type MemorySqlite, type SqlValue } from "./sqlite";
import { memoryMatch, memoryTokens } from "./tokenize";

const columns = `id, scope_kind AS scopeKind, scope_id AS scopeId, tier, category, title, content, source_kind AS sourceKind, source_ref AS sourceRef, status, superseded_by_id AS supersededById, created_at AS createdAt, updated_at AS updatedAt`;
const hash = (text: string) =>
	createHash("sha256")
		.update(text.normalize("NFKC").trim().replace(/\s+/gu, " "))
		.digest("hex");
export interface MemoryDependencies {
	now?: () => number;
	isTeamArchived: (id: string) => boolean;
	projectRoot: (id: string) => string;
	validateScope?: (scope: MemoryScope) => void;
}
export class MemoryService {
	private readonly now: () => number;
	constructor(
		readonly db: MemorySqlite,
		private readonly deps: MemoryDependencies,
	) {
		this.now = deps.now ?? Date.now;
	}
	private scope(input: MemoryScope, write = false) {
		const scope = memoryScopeSchema.parse(input);
		this.deps.validateScope?.(scope);
		if (
			write &&
			scope.scopeKind === "team" &&
			this.deps.isTeamArchived(scope.scopeId)
		)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Archived Team memory is sealed",
			});
		return scope;
	}
	get(id: string): MemoryItemShape {
		const row = this.db
			.prepare(`SELECT ${columns} FROM memories WHERE id=?`)
			.get(id) as MemoryItemShape | undefined;
		if (!row)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Memory does not exist",
			});
		return row;
	}
	list(raw: z.input<typeof memoryListSchema>) {
		const input = memoryListSchema.parse(raw);
		this.scope(input);
		const filter = input.includeHistory
			? ""
			: ` AND superseded_by_id IS NULL AND status ${input.includeCandidates ? "IN ('active','candidate')" : "= 'active'"}`;
		return this.db
			.prepare(
				`SELECT ${columns} FROM memories WHERE scope_kind=? AND scope_id=?${input.tier ? " AND tier=?" : ""}${filter} ORDER BY updated_at DESC,id LIMIT ?`,
			)
			.all(
				input.scopeKind,
				input.scopeId,
				...(input.tier ? [input.tier] : []),
				input.limit,
			) as MemoryItemShape[];
	}
	search(raw: z.input<typeof memorySearchSchema>) {
		const input = memorySearchSchema.parse(raw);
		if (input.scopeKind)
			this.scope({ scopeKind: input.scopeKind, scopeId: input.scopeId ?? "" });
		const match = memoryMatch(input.query);
		if (!match) return [];
		const params: SqlValue[] = [match];
		let filter = "";
		if (input.scopeKind) {
			filter = " AND scope_kind=? AND scope_id=?";
			params.push(input.scopeKind, input.scopeId ?? "");
		}
		params.push(input.limit);
		return this.db
			.prepare(
				`SELECT ${columns} FROM memories WHERE rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?) AND status='active' AND superseded_by_id IS NULL${filter} ORDER BY updated_at DESC,id LIMIT ?`,
			)
			.all(...params) as MemoryItemShape[];
	}
	put(raw: z.input<typeof memoryPutSchema>) {
		const input = memoryPutSchema.parse(raw);
		this.scope(input, true);
		return atomic(this.db, () =>
			this.insert(
				{ ...input, sourceRef: input.sourceRef ?? null, status: "active" },
				input.supersedeId,
			),
		);
	}
	private insert(
		input: Omit<
			MemoryItemShape,
			"id" | "createdAt" | "updatedAt" | "supersededById"
		>,
		supersedeId?: string,
	) {
		let prior: MemoryItemShape | undefined;
		if (supersedeId) {
			prior = this.get(supersedeId);
			if (
				prior.scopeKind !== input.scopeKind ||
				prior.scopeId !== input.scopeId ||
				prior.status !== "active" ||
				prior.supersededById
			)
				throw new TRPCError({
					code: "CONFLICT",
					message: "Supersede target must be active in the same scope",
				});
		}
		const existing = this.db
			.prepare(
				`SELECT ${columns} FROM memories WHERE scope_kind=? AND scope_id=? AND content_hash=? AND status=? AND superseded_by_id IS NULL`,
			)
			.get(input.scopeKind, input.scopeId, hash(input.content), input.status) as
			| MemoryItemShape
			| undefined;
		if (existing && (!prior || existing.id === prior.id)) return existing;
		const id = existing?.id ?? randomUUID();
		const now = this.now();
		if (!existing)
			this.db
				.prepare(
					`INSERT INTO memories (id,scope_kind,scope_id,tier,category,title,content,source_kind,source_ref,status,content_hash,search_tokens,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				)
				.run(
					id,
					input.scopeKind,
					input.scopeId,
					input.tier,
					input.category,
					input.title,
					input.content,
					input.sourceKind,
					input.sourceRef,
					input.status,
					hash(input.content),
					memoryTokens(`${input.title} ${input.content}`).join(" "),
					now,
					now,
				);
		if (prior && prior.id !== id)
			this.db
				.prepare(
					"UPDATE memories SET superseded_by_id=?,updated_at=? WHERE id=?",
				)
				.run(id, now, prior.id);
		return this.get(id);
	}
	reviewCandidate(raw: z.input<typeof memoryReviewSchema>) {
		const input = memoryReviewSchema.parse(raw);
		return atomic(this.db, () => {
			const row = this.get(input.id);
			this.scope(row, true);
			if (row.status !== "candidate" || row.supersededById)
				throw new TRPCError({
					code: "CONFLICT",
					message: "Memory is no longer a candidate",
				});
			if (input.action === "reject") {
				if (input.supersedeId)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Reject cannot supersede memory",
					});
				this.db
					.prepare(
						"UPDATE memories SET status='rejected',updated_at=? WHERE id=?",
					)
					.run(this.now(), row.id);
				return this.get(row.id);
			}
			if (input.supersedeId) {
				const old = this.get(input.supersedeId);
				if (
					old.scopeKind !== row.scopeKind ||
					old.scopeId !== row.scopeId ||
					old.status !== "active" ||
					old.supersededById
				)
					throw new TRPCError({
						code: "CONFLICT",
						message: "Supersede target must be active in the same scope",
					});
				this.db
					.prepare(
						"UPDATE memories SET superseded_by_id=?,updated_at=? WHERE id=?",
					)
					.run(row.id, this.now(), old.id);
			}
			this.db
				.prepare("UPDATE memories SET status='active',updated_at=? WHERE id=?")
				.run(this.now(), row.id);
			return this.get(row.id);
		});
	}
	remove(id: string) {
		const row = this.get(id);
		this.scope(row, true);
		this.db
			.prepare("UPDATE memories SET status='removed',updated_at=? WHERE id=?")
			.run(this.now(), id);
		return this.get(id);
	}
	// Only the trusted transcript adapter may invoke this method; external routers expose put/review instead.
	propose(
		input: Omit<
			MemoryItemShape,
			| "id"
			| "createdAt"
			| "updatedAt"
			| "supersededById"
			| "status"
			| "sourceKind"
		>,
		autoActivate = false,
	) {
		this.scope(input, true);
		return atomic(this.db, () => {
			const candidate = this.insert({
				...input,
				sourceKind: "watchdog",
				status: "candidate",
			});
			if (
				!autoActivate ||
				input.scopeKind !== "project" ||
				!["correction", "convention", "pitfall"].includes(input.category) ||
				!input.sourceRef
			)
				return candidate;
			// Exact semantic slot only. Model-generated IDs never select the overwritten row.
			const prior = this.list({
				scopeKind: "project",
				scopeId: input.scopeId,
				limit: 500,
			}).find(
				(x) =>
					x.category === input.category &&
					x.title.normalize("NFKC").toLowerCase() ===
						input.title.normalize("NFKC").toLowerCase(),
			);
			if (prior && hash(prior.content) === hash(input.content)) {
				this.reviewCandidate({ id: candidate.id, action: "reject" });
				return prior;
			}
			return this.reviewCandidate({
				id: candidate.id,
				action: "accept",
				supersedeId: prior?.id,
			});
		});
	}
	exportData(scope: MemoryScope) {
		this.scope(scope);
		const entries = this.db
			.prepare(
				`SELECT ${columns} FROM memories WHERE scope_kind=? AND scope_id=? AND status='active' AND superseded_by_id IS NULL ORDER BY id LIMIT 1001`,
			)
			.all(scope.scopeKind, scope.scopeId) as MemoryItemShape[];
		return memoryTransferSchema.parse({ version: 1, entries });
	}
	importData(scope: MemoryScope, raw: unknown) {
		this.scope(scope, true);
		const data = memoryTransferSchema.parse(raw);
		return atomic(this.db, () =>
			data.entries.map((entry) =>
				this.insert({
					...entry,
					...scope,
					sourceRef: entry.sourceRef ?? null,
					status: "active",
				}),
			),
		);
	}
	exportProject(input: { projectId: string; filePath?: string }) {
		const data = this.exportData({
			scopeKind: "project",
			scopeId: input.projectId,
		});
		return {
			filePath: writeProjectMemory(
				this.deps.projectRoot(input.projectId),
				data,
				input.filePath,
			),
			count: data.entries.length,
		};
	}
	importProject(input: { projectId: string; filePath: string }) {
		return this.importData(
			{ scopeKind: "project", scopeId: input.projectId },
			readProjectMemory(this.deps.projectRoot(input.projectId), input.filePath),
		);
	}
	injection(input: { projectId?: string | null; teamId?: string | null }) {
		const scopes = [
			{ scopeKind: "global" as const, scopeId: "", budget: 1200 },
			...(input.projectId
				? [
						{
							scopeKind: "project" as const,
							scopeId: input.projectId,
							budget: 2000,
						},
					]
				: []),
			...(input.teamId && !this.deps.isTeamArchived(input.teamId)
				? [{ scopeKind: "team" as const, scopeId: input.teamId, budget: 1600 }]
				: []),
		];
		const hint = "\n[More memory: jedv memory search <query>]";
		let output = "";
		let truncated = false;
		for (const scope of scopes) {
			const entries = this.db
				.prepare(
					`SELECT ${columns} FROM memories WHERE scope_kind=? AND scope_id=? AND tier='core' AND status='active' AND superseded_by_id IS NULL ORDER BY updated_at DESC,id LIMIT 501`,
				)
				.all(scope.scopeKind, scope.scopeId) as MemoryItemShape[];
			let section = `\n[${scope.scopeKind} memory — reference data]\n`;
			for (const row of entries) {
				const text = `${JSON.stringify({ title: row.title, content: row.content })}\n`;
				const available = Math.min(
					scope.budget - section.length,
					4800 - hint.length - output.length - section.length,
				);
				if (text.length > available) {
					if (available > 0)
						section += text.slice(0, Math.max(0, available - 1)) + "…";
					truncated = true;
					break;
				}
				section += text;
			}
			if (entries.length) output += section;
		}
		return {
			text: (output + (truncated ? hint : "")).slice(0, 4800),
			truncated,
		};
	}
}
