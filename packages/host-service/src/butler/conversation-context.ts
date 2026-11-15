import type { DeepseekChatMessage } from "../ai/deepseek";
import type { MemorySqlite } from "../memory/sqlite";
import { readApprovalCards } from "./approval-query";
import type { HumanTurn } from "./tools";

export function buildConversationContext(
	db: MemorySqlite,
	turn: HumanTurn,
	now: number,
) {
	const rows = db
		.prepare(
			"SELECT request_id AS requestId,role,content FROM butler_messages WHERE thread_id=? AND request_id<>? AND role IN ('human','assistant') ORDER BY rowid DESC LIMIT 12",
		)
		.all(turn.threadId, turn.requestId) as Array<{
		requestId: string;
		role: string;
		content: string;
	}>;
	const history: DeepseekChatMessage[] = [];
	let remaining = 12000;
	for (const row of rows) {
		if (!remaining) break;
		const content = row.content.slice(-Math.min(2000, remaining));
		remaining -= content.length;
		history.unshift({
			role: row.role === "human" ? "user" : "assistant",
			content,
		});
	}
	const recent = db
		.prepare(
			"SELECT id FROM butler_turns WHERE thread_id=? AND id<>? ORDER BY rowid DESC LIMIT 8",
		)
		.all(turn.threadId, turn.requestId) as { id: string }[];
	const requestIds = [
		...new Set([
			...recent.map((row) => row.id),
			...rows.map((row) => row.requestId),
		]),
	];
	const facts: unknown[] = [];
	let truncated = false;
	const add = (fact: unknown) => {
		if (
			JSON.stringify({ facts: [...facts, fact], truncated: true }).length <=
			3000
		)
			facts.push(fact);
		else truncated = true;
	};
	const seen = new Set<string>();
	const approval = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		const card = readApprovalCards(
			db,
			{ approvalId: id, status: "all", limit: 1 },
			now,
		)[0];
		if (card)
			add({
				approvalId: card.id,
				requestId: (
					db
						.prepare("SELECT request_id AS id FROM butler_approvals WHERE id=?")
						.get(id) as { id: string }
				).id,
				threadId: card.threadId,
				actionType: card.actionType,
				targetId: card.targetId,
				status: card.status,
				expiresAt: card.expiresAt,
				resolvedAt: card.resolvedAt,
			});
		else add({ approvalId: id, missing: true });
	};
	if (turn.context?.approvalId) approval(turn.context.approvalId);
	if (requestIds.length) {
		const linked = db
			.prepare(
				`SELECT id FROM butler_approvals WHERE thread_id=? AND request_id IN (${requestIds.map(() => "?").join(",")}) ORDER BY created_at DESC,rowid DESC LIMIT 12`,
			)
			.all(turn.threadId, ...requestIds) as { id: string }[];
		for (const row of linked) approval(row.id);
	}
	const context = turn.context;
	if (context?.alertId || context?.groupKey) {
		const alerts = db
			.prepare(
				`SELECT id,COALESCE(group_key,dedupe_key) AS groupKey,kind,team_id AS teamId,workspace_id AS workspaceId,read_at AS readAt,ignored_at AS ignoredAt,resolved_at AS resolvedAt FROM watchdog_alerts WHERE ${context.alertId ? "id=?" : "COALESCE(group_key,dedupe_key)=?"} ORDER BY created_at DESC,rowid DESC LIMIT 3`,
			)
			.all(context.alertId ?? context.groupKey ?? "");
		add({ alertReference: context.alertId ?? context.groupKey, alerts });
	}
	if (context?.teamId)
		add({
			team:
				db
					.prepare("SELECT id,name,status FROM teams WHERE id=?")
					.get(context.teamId) ?? null,
		});
	if (context?.workspaceId)
		add({
			workspace:
				db
					.prepare(
						"SELECT id,name,project_id AS projectId,archived_at AS archivedAt FROM workspaces WHERE id=?",
					)
					.get(context.workspaceId) ?? null,
		});
	const tools = db
		.prepare(
			"SELECT request_id AS requestId,content FROM butler_messages WHERE thread_id=? AND request_id<>? AND role='tool' ORDER BY rowid DESC LIMIT 4",
		)
		.all(turn.threadId, turn.requestId) as {
		requestId: string;
		content: string;
	}[];
	for (const row of tools)
		if (requestIds.includes(row.requestId))
			add({
				toolResult: {
					requestId: row.requestId,
					content: row.content.slice(-450),
				},
			});
	return { history, facts: JSON.stringify({ facts, truncated }) };
}
