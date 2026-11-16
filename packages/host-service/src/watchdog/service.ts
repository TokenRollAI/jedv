import { createHash, randomUUID } from "node:crypto";
import {
	type AttentionAlertShape,
	type AttentionGroupShape,
	type AttentionSourceInput,
	type AttentionSourceTarget,
	attentionIgnoreSchema,
	attentionQuerySchema,
	attentionSelectorSchema,
	type ButlerBadgeSummary,
} from "@jedv/shared/butler-attention";
import type { WatchdogAlertShape } from "@jedv/shared/memory";
import type { z } from "zod";
import type { MemorySqlite } from "../memory/sqlite";
import { attentionSource } from "./source";
export interface WatchdogClock {
	now(): number;
	setInterval(callback: () => void, ms: number): () => void;
}
export const watchdogClock: WatchdogClock = {
	now: Date.now,
	setInterval(fn, ms) {
		const timer = setInterval(fn, ms);
		timer.unref();
		return () => clearInterval(timer);
	},
};
interface SourceFields {
	projectId?: string | null;
	workspaceId?: string | null;
	terminalId?: string | null;
}
export interface WatchdogSnapshot {
	members: (SourceFields & {
		id: string;
		teamId: string;
		working: boolean;
		startedAt: number;
		lastAgentActivityAt: number;
		lastGitActivityAt: number | null;
		permissionRequested?: boolean;
		status?: string;
		teamStatus?: string;
		activityKnown?: boolean;
		uncertainDeliveryIds?: string[];
		faultKey?: string;
	})[];
	mail: (SourceFields & {
		id: string;
		teamId: string | null;
		recipientMemberId?: string | null;
		createdAt: number;
		ackedAt: number | null;
		nudgeState?: string;
		nudgedAt?: number | null;
		attemptCount?: number;
		recipientReadAt?: number | null;
	})[];
	automationRuns: (SourceFields & {
		id: string;
		automationId: string;
		status: string;
		createdAt?: number;
		finishedAt: number | null;
	})[];
}
// No model, ACK, terminal mutation or tool capability is exposed to this adapter.
export interface WatchdogMailAdapter {
	publishAlert(alert: WatchdogAlertShape): Promise<void>;
}
type AlertRow = Omit<AttentionAlertShape, "source">;
const alertColumns = `id,dedupe_key AS dedupeKey,kind,subject,body,team_id AS teamId,created_at AS createdAt,read_at AS readAt,
 COALESCE(group_key,dedupe_key) AS groupKey,severity,project_id AS projectId,workspace_id AS workspaceId,terminal_id AS terminalId,
 member_id AS memberId,mail_delivery_id AS mailDeliveryId,automation_id AS automationId,automation_run_id AS automationRunId,
 ignored_at AS ignoredAt,ignore_reason AS ignoreReason,resolved_at AS resolvedAt`;
const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
function sourceInput(row: AlertRow): AttentionSourceInput {
	return {
		...row,
		kind:
			row.kind === "mail_unacked"
				? "mail_delivery"
				: row.kind === "automation_failed"
					? "automation_run"
					: "team_member",
	};
}
export class RuleWatchdog {
	private stopTimer?: () => void;
	private inflight?: Promise<void>;
	private disposed = false;
	private readonly clock: WatchdogClock;
	constructor(
		private readonly deps: {
			db: MemorySqlite;
			snapshot: () => WatchdogSnapshot | Promise<WatchdogSnapshot>;
			mail?: WatchdogMailAdapter;
			clock?: WatchdogClock;
			stalledAfterMs?: number;
			mailAfterMs?: number;
			locateSources?: (
				inputs: AttentionSourceInput[],
			) => Promise<AttentionSourceTarget[]>;
		},
	) {
		this.clock = deps.clock ?? watchdogClock;
	}
	start() {
		if (this.disposed || this.stopTimer) return;
		this.stopTimer = this.clock.setInterval(() => {
			void this.scan().catch(() => {});
		}, 30000);
	}
	async dispose() {
		this.disposed = true;
		this.stopTimer?.();
		this.stopTimer = undefined;
		await this.inflight?.catch(() => {});
	}
	scan(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.inflight) return this.inflight;
		this.inflight = this.inspect().finally(() => {
			this.inflight = undefined;
		});
		return this.inflight;
	}
	private async inspect() {
		const snapshot = await this.deps.snapshot();
		if (this.disposed) return;
		const now = this.clock.now();
		// Kind is a stored structured fact even when the old source run aged out of a capped list.
		this.deps.db
			.prepare(
				"UPDATE watchdog_alerts SET severity='high' WHERE kind IN ('automation_failed','team_attention') AND severity<>'high'",
			)
			.run();
		const metadata = (
			key: string,
			group: string,
			severity: "high" | "normal",
			source: AttentionSourceInput,
		) => {
			// Only an exact dedupe key derived from structured host facts can enrich legacy rows.
			this.deps.db
				.prepare(`UPDATE watchdog_alerts SET group_key=COALESCE(group_key,?),severity=?,
    project_id=COALESCE(project_id,?),workspace_id=COALESCE(workspace_id,?),terminal_id=COALESCE(terminal_id,?),
    member_id=COALESCE(member_id,?),mail_delivery_id=COALESCE(mail_delivery_id,?),automation_id=COALESCE(automation_id,?),automation_run_id=COALESCE(automation_run_id,?) WHERE dedupe_key=?`)
				.run(
					group,
					severity,
					source.projectId ?? null,
					source.workspaceId ?? null,
					source.terminalId ?? null,
					source.memberId ?? null,
					source.mailDeliveryId ?? null,
					source.automationId ?? null,
					source.automationRunId ?? null,
					key,
				);
		};
		const insert = (
			key: string,
			group: string,
			kind: WatchdogAlertShape["kind"],
			severity: "high" | "normal",
			subject: string,
			body: string,
			source: AttentionSourceInput,
		) => {
			this.deps.db
				.prepare(
					`INSERT OR IGNORE INTO watchdog_alerts(id,dedupe_key,group_key,kind,severity,subject,body,team_id,created_at,project_id,workspace_id,terminal_id,member_id,mail_delivery_id,automation_id,automation_run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				)
				.run(
					randomUUID(),
					key,
					group,
					kind,
					severity,
					subject,
					body,
					source.teamId ?? null,
					now,
					source.projectId ?? null,
					source.workspaceId ?? null,
					source.terminalId ?? null,
					source.memberId ?? null,
					source.mailDeliveryId ?? null,
					source.automationId ?? null,
					source.automationRunId ?? null,
				);
			metadata(key, group, severity, source);
		};
		const resolveGroup = (group: string, except?: string) =>
			this.deps.db
				.prepare(
					`UPDATE watchdog_alerts SET resolved_at=? WHERE COALESCE(group_key,dedupe_key)=? AND resolved_at IS NULL${except ? " AND dedupe_key<>?" : ""}`,
				)
				.run(now, group, ...(except ? [except] : []));
		for (const member of snapshot.members) {
			const source: AttentionSourceInput = {
				...member,
				kind: "team_member",
				memberId: member.id,
			};
			const progress = Math.max(
				member.startedAt,
				member.lastAgentActivityAt,
				member.lastGitActivityAt ?? member.startedAt,
			);
			const stalledGroup = `suspected_stalled:${member.teamId}:${member.id}`,
				stalledKey = `stalled:${member.id}:${member.startedAt}:${progress}`;
			metadata(stalledKey, stalledGroup, "normal", source);
			const ended =
				(member.teamStatus !== undefined &&
					!["active", "paused"].includes(member.teamStatus)) ||
				["stopped", "ended"].includes(member.status ?? "");
			const known = member.activityKnown !== false;
			const stalled =
				!ended &&
				known &&
				member.working &&
				!member.permissionRequested &&
				now - progress >= (this.deps.stalledAfterMs ?? 15 * 60000);
			if (stalled) {
				insert(
					stalledKey,
					stalledGroup,
					"suspected_stalled",
					"normal",
					"Agent may be stalled",
					"No recent Agent or Git activity was observed. This is a suspicion; inspect the terminal before acting.",
					source,
				);
				// A different observed activity watermark is positive recovery evidence for prior instances.
				resolveGroup(stalledGroup, stalledKey);
			} else if (
				ended ||
				(known &&
					(!member.working ||
						member.permissionRequested ||
						now - progress < (this.deps.stalledAfterMs ?? 15 * 60000)))
			)
				resolveGroup(stalledGroup);
			const faultGroup = `team_attention:${member.teamId}:${member.id}`;
			const uncertain = [...(member.uncertainDeliveryIds ?? [])].sort();
			const statusFault = ["reconcile_required", "failed"].includes(
				member.status ?? "",
			);
			const observations = ended
				? []
				: [
						...(statusFault
							? [
									{
										base: `team:${member.id}:status:${hash([member.status, member.faultKey])}`,
										source,
									},
								]
							: []),
						...uncertain.map((deliveryId) => ({
							base: `team:${member.id}:delivery:${hash(deliveryId)}`,
							source: { ...source, mailDeliveryId: deliveryId },
						})),
					];
			for (const observation of observations) {
				const prefix = `${observation.base}:episode:`;
				const previous = this.deps.db
					.prepare(
						"SELECT dedupe_key AS key,resolved_at AS resolvedAt FROM watchdog_alerts WHERE dedupe_key=? OR substr(dedupe_key,1,?)=? ORDER BY rowid DESC LIMIT 1",
					)
					.get(observation.base, prefix.length, prefix) as
					| { key: string; resolvedAt: number | null }
					| undefined;
				const key = !previous
					? observation.base
					: previous.resolvedAt === null
						? previous.key
						: prefix + randomUUID();
				insert(
					key,
					faultGroup,
					"team_attention",
					"high",
					"Team member needs attention",
					"A member requires reconciliation, failed, or has uncertain mail staging. Inspect its current state before acting.",
					observation.source,
				);
			}
			if (ended) resolveGroup(faultGroup);
			else {
				const faults = this.deps.db
					.prepare(
						"SELECT id,mail_delivery_id AS deliveryId FROM watchdog_alerts WHERE group_key=? AND resolved_at IS NULL",
					)
					.all(faultGroup) as { id: string; deliveryId: string | null }[];
				for (const fault of faults)
					if (
						fault.deliveryId
							? member.uncertainDeliveryIds !== undefined &&
								!uncertain.includes(fault.deliveryId)
							: member.status !== undefined && !statusFault
					)
						this.deps.db
							.prepare(
								"UPDATE watchdog_alerts SET resolved_at=? WHERE id=? AND resolved_at IS NULL",
							)
							.run(now, fault.id);
			}
		}
		// Retire the old age-only reminder policy without changing Mail read/ACK.
		// These rows remain in handled audit history; they are not consumption proof.
		this.deps.db
			.prepare(
				"UPDATE watchdog_alerts SET resolved_at=?,body=body || char(10) || char(10) || 'Routine Mail acknowledgement is handled by the recipient Agent. This reminder was retired; Mail consumption is unchanged.' WHERE kind='mail_unacked' AND resolved_at IS NULL AND dedupe_key NOT LIKE 'mail-exception:%'",
			)
			.run(now);
		const membersById = new Map(
			snapshot.members.map((member) => [member.id, member]),
		);
		for (const mail of snapshot.mail) {
			const member = mail.recipientMemberId
				? membersById.get(mail.recipientMemberId)
				: undefined;
			const stopped =
				member?.status === "stopped" &&
				member.teamStatus === "active" &&
				now - Math.max(mail.createdAt, member.lastAgentActivityAt) >=
					(this.deps.mailAfterMs ?? 30 * 60000);
			const unobserved =
				mail.nudgeState === "nudged" &&
				mail.recipientReadAt === null &&
				mail.nudgedAt != null &&
				now - mail.nudgedAt >= 120_000 &&
				member?.activityKnown === true &&
				member.lastAgentActivityAt <= mail.nudgedAt;
			const problem = unobserved
				? "notification_unobserved"
				: mail.nudgeState === "failed"
					? "failed"
					: mail.nudgeState === "uncertain_staged"
						? "uncertain"
						: stopped
							? "recipient_stopped"
							: null;
			const group =
				mail.teamId && mail.recipientMemberId
					? `mail_unacked:${mail.teamId}:${mail.recipientMemberId}`
					: `mail:${mail.id}`;
			const source: AttentionSourceInput = {
				...mail,
				kind: "mail_delivery",
				memberId: mail.recipientMemberId,
				mailDeliveryId: mail.id,
			};
			const prefix = `mail-exception:${mail.id}:`;
			const recovered = [
				...(mail.recipientReadAt != null ||
				(mail.nudgeState !== undefined && mail.nudgeState !== "nudged") ||
				(mail.nudgedAt != null &&
					member?.activityKnown === true &&
					member.lastAgentActivityAt > mail.nudgedAt)
					? ["notification_unobserved"]
					: []),
				...(mail.nudgeState !== undefined && mail.nudgeState !== "failed"
					? ["failed"]
					: []),
				...(mail.nudgeState !== undefined &&
				mail.nudgeState !== "uncertain_staged"
					? ["uncertain"]
					: []),
				...(member?.status !== undefined &&
				member.teamStatus !== undefined &&
				(member.status !== "stopped" || member.teamStatus !== "active")
					? ["recipient_stopped"]
					: []),
			];
			if (mail.ackedAt !== null) {
				this.deps.db
					.prepare(
						"UPDATE watchdog_alerts SET resolved_at=? WHERE substr(dedupe_key,1,?)=? AND resolved_at IS NULL",
					)
					.run(now, prefix.length, prefix);
				continue;
			}
			for (const reason of recovered) {
				const base = `${prefix}${reason}`;
				this.deps.db
					.prepare(
						"UPDATE watchdog_alerts SET resolved_at=? WHERE (dedupe_key=? OR substr(dedupe_key,1,?)=?) AND resolved_at IS NULL",
					)
					.run(now, base, base.length + 9, `${base}:episode:`);
			}
			if (!problem || mail.ackedAt !== null) continue;
			// The member fault already explains uncertain delivery; avoid a second card.
			if (
				problem === "uncertain" &&
				member?.uncertainDeliveryIds?.includes(mail.id) &&
				!["stopped", "ended"].includes(member.status ?? "") &&
				(member.teamStatus === undefined ||
					["active", "paused"].includes(member.teamStatus))
			)
				continue;
			const base = `${prefix}${problem}`;
			const previous = this.deps.db
				.prepare(
					"SELECT dedupe_key AS key,resolved_at AS resolvedAt FROM watchdog_alerts WHERE dedupe_key=? OR substr(dedupe_key,1,?)=? ORDER BY rowid DESC LIMIT 1",
				)
				.get(base, base.length + 9, `${base}:episode:`) as
				| { key: string; resolvedAt: number | null }
				| undefined;
			const key = !previous
				? base
				: previous.resolvedAt === null
					? previous.key
					: `${base}:episode:${randomUUID()}`;
			insert(
				key,
				group,
				"mail_unacked",
				"high",
				problem === "notification_unobserved"
					? "Mail notification has no Agent activity confirmation"
					: problem === "uncertain"
						? "Mail delivery outcome is uncertain"
						: problem === "failed"
							? "Mail delivery failed"
							: "Mail recipient is no longer running",
				problem === "notification_unobserved"
					? "A Mail notification was submitted, but no subsequent activity was observed from this recipient. Inspect or restore the intended Agent; automatic input is withheld without a fresh safe turn boundary. Do not acknowledge on its behalf."
					: problem === "uncertain"
						? "The delivery may already have reached the Agent. Inspect the recipient terminal and Mail history before reconciling; automatic retry is withheld to avoid duplicate execution."
						: problem === "failed"
							? "Automatic delivery failed. Inspect the recipient session and delivery details, then retry only after confirming no input was staged. Do not acknowledge on the Agent's behalf."
							: "The recipient has stopped while this Team remains active and Mail has waited at least 30 minutes. Resume the intended Agent or reassign the task; acknowledgement remains the recipient's responsibility.",
				source,
			);
		}

		const runs = new Map(snapshot.automationRuns.map((run) => [run.id, run]));
		for (const run of snapshot.automationRuns) {
			const key = `automation:${run.id}`,
				group = `automation_failed:${run.automationId}`;
			const source: AttentionSourceInput = {
				...run,
				kind: "automation_run",
				automationRunId: run.id,
			};
			metadata(key, group, "high", source);
			if (["failed", "interrupted"].includes(run.status))
				insert(
					key,
					group,
					"automation_failed",
					"high",
					"Automation did not finish",
					`Automation ${run.automationId}, run ${run.id}, ended as ${run.status}.`,
					source,
				);
		}
		const failures = this.deps.db
			.prepare(
				`SELECT ${alertColumns} FROM watchdog_alerts WHERE kind='automation_failed' AND resolved_at IS NULL`,
			)
			.all() as AlertRow[];
		for (const failure of failures) {
			const failed = failure.automationRunId
				? runs.get(failure.automationRunId)
				: undefined;
			const succeeded = snapshot.automationRuns.some(
				(run) =>
					run.automationId === failure.automationId &&
					run.status === "succeeded" &&
					run.finishedAt !== null &&
					(failed
						? run.id !== failed.id &&
							run.finishedAt > (failed.finishedAt ?? failure.createdAt) &&
							(run.createdAt === undefined ||
								failed.createdAt === undefined ||
								run.createdAt > failed.createdAt)
						: run.createdAt !== undefined &&
							run.createdAt > failure.createdAt &&
							run.finishedAt > failure.createdAt),
			);
			if (succeeded)
				this.deps.db
					.prepare(
						"UPDATE watchdog_alerts SET resolved_at=? WHERE id=? AND resolved_at IS NULL",
					)
					.run(now, failure.id);
		}
		// Snapshot lists may be truncated. Absence never constitutes recovery evidence.
		if (!this.deps.mail || this.disposed) return;
		const pending = this.deps.db
			.prepare(
				`SELECT ${alertColumns} FROM watchdog_alerts WHERE delivered_at IS NULL AND resolved_at IS NULL AND ignored_at IS NULL ORDER BY created_at,id LIMIT 100`,
			)
			.all() as AlertRow[];
		for (const alert of pending) {
			if (this.disposed) break;
			try {
				await this.deps.mail.publishAlert(alert);
				this.deps.db
					.prepare("UPDATE watchdog_alerts SET delivered_at=? WHERE id=?")
					.run(this.clock.now(), alert.id);
			} catch {
				/* Retry the stable transport dedupe key on the next scan. */
			}
		}
	}
	listAlerts(input: { status?: "unread" | "all"; limit?: number } = {}) {
		return this.deps.db
			.prepare(
				`SELECT ${alertColumns} FROM watchdog_alerts ${input.status === "all" ? "" : "WHERE read_at IS NULL"} ORDER BY created_at DESC,id LIMIT ?`,
			)
			.all(Math.max(1, Math.min(500, input.limit ?? 100))) as AlertRow[];
	}
	markRead(id: string) {
		this.markAttentionRead({ alertId: id });
		return { id };
	}
	markAttentionRead(raw: z.input<typeof attentionSelectorSchema>) {
		const x = attentionSelectorSchema.parse(raw);
		const result = this.deps.db
			.prepare(
				`UPDATE watchdog_alerts SET read_at=COALESCE(read_at,?) WHERE ${x.groupKey ? "COALESCE(group_key,dedupe_key)=? AND resolved_at IS NULL" : "id=?"} AND read_at IS NULL`,
			)
			.run(this.clock.now(), x.groupKey ?? x.alertId ?? "") as {
			changes: number;
		};
		return { updatedCount: result.changes };
	}
	ignoreAttention(raw: z.input<typeof attentionIgnoreSchema>) {
		const x = attentionIgnoreSchema.parse(raw),
			now = this.clock.now();
		const result = this.deps.db
			.prepare(
				`UPDATE watchdog_alerts SET ignored_at=?,ignore_reason=?,read_at=COALESCE(read_at,?) WHERE ${x.groupKey ? "COALESCE(group_key,dedupe_key)=?" : "id=?"} AND resolved_at IS NULL AND ignored_at IS NULL`,
			)
			.run(now, x.reason ?? null, now, x.groupKey ?? x.alertId ?? "") as {
			changes: number;
		};
		return { updatedCount: result.changes, disposition: "ignored" as const };
	}
	badgeSummary(pendingApprovals = 0): ButlerBadgeSummary {
		const row = this.deps.db
			.prepare(
				"SELECT COUNT(DISTINCT COALESCE(group_key,dedupe_key)) AS count FROM watchdog_alerts WHERE resolved_at IS NULL AND ignored_at IS NULL AND read_at IS NULL AND severity='high'",
			)
			.get() as { count: number };
		const pending = Number.isFinite(pendingApprovals)
			? Math.max(0, Math.floor(pendingApprovals))
			: 0;
		return {
			pendingApprovals: pending,
			unreadHighFaultGroups: row.count,
			count: pending + row.count,
		};
	}
	async locateSources(
		inputs: AttentionSourceInput[],
	): Promise<AttentionSourceTarget[]> {
		return this.deps.locateSources
			? this.deps.locateSources(inputs)
			: inputs.map(attentionSource);
	}
	async locateSource(input: AttentionSourceInput) {
		return (await this.locateSources([input]))[0] ?? attentionSource(input);
	}
	async attention(
		raw: z.input<typeof attentionQuerySchema> = {},
	): Promise<AttentionGroupShape[]> {
		const x = attentionQuerySchema.parse(raw);
		const groups = this.deps.db
			.prepare(`SELECT COALESCE(group_key,dedupe_key) AS groupKey,COUNT(*) AS totalCount,
   SUM(resolved_at IS NULL) AS activeCount,SUM(resolved_at IS NULL AND ignored_at IS NULL) AS openCount,
   SUM(resolved_at IS NULL AND ignored_at IS NULL AND read_at IS NULL) AS unreadCount,
   MAX(CASE WHEN severity='high' THEN 1 ELSE 0 END) AS high,MIN(created_at) AS firstCreatedAt,MAX(created_at) AS latestCreatedAt
   FROM watchdog_alerts GROUP BY COALESCE(group_key,dedupe_key)
   HAVING ${x.view === "all" ? "1" : x.view === "open" ? "openCount>0" : "openCount=0"} ORDER BY latestCreatedAt DESC,groupKey LIMIT ?`)
			.all(x.limit) as {
			groupKey: string;
			totalCount: number;
			activeCount: number;
			openCount: number;
			unreadCount: number;
			high: number;
			firstCreatedAt: number;
			latestCreatedAt: number;
		}[];
		const result: AttentionGroupShape[] = [];
		const pending: {
			row: AlertRow;
			assign: (source: AttentionSourceTarget) => void;
		}[] = [];
		for (const group of groups) {
			const representative = this.deps.db
				.prepare(
					`SELECT ${alertColumns} FROM watchdog_alerts WHERE COALESCE(group_key,dedupe_key)=? ORDER BY (resolved_at IS NULL) DESC,created_at DESC,rowid DESC LIMIT 1`,
				)
				.get(group.groupKey) as AlertRow;
			const rows = this.deps.db
				.prepare(
					`SELECT ${alertColumns} FROM watchdog_alerts WHERE COALESCE(group_key,dedupe_key)=? ORDER BY created_at DESC,rowid DESC LIMIT 20`,
				)
				.all(group.groupKey) as AlertRow[];
			const item: AttentionGroupShape = {
				groupKey: group.groupKey,
				kind: representative.kind,
				severity: group.high ? "high" : "normal",
				subject: representative.subject,
				body: representative.body,
				disposition:
					group.openCount > 0
						? "open"
						: group.activeCount > 0
							? "ignored"
							: "resolved",
				unread: group.unreadCount > 0,
				activeCount: group.activeCount,
				totalCount: group.totalCount,
				firstCreatedAt: group.firstCreatedAt,
				latestCreatedAt: group.latestCreatedAt,
				source: attentionSource(sourceInput(representative)),
				items: [],
			};
			pending.push({
				row: representative,
				assign: (source) => {
					item.source = source;
				},
			});
			for (const row of rows) {
				const entry = { ...row, source: attentionSource(sourceInput(row)) };
				item.items.push(entry);
				pending.push({
					row,
					assign: (source) => {
						entry.source = source;
					},
				});
			}
			result.push(item);
		}
		const sources = await this.locateSources(
			pending.map((item) => sourceInput(item.row)),
		);
		pending.forEach((item, index) => {
			const source = sources[index];
			if (source) item.assign(source);
		});
		return result;
	}
}
