import { z } from "zod";
import type { WatchdogAlertShape } from "./memory";

export const attentionQuerySchema = z
	.object({
		view: z.enum(["open", "handled", "all"]).default("open"),
		limit: z.number().int().min(1).max(500).default(100),
	})
	.default({ view: "open", limit: 100 });
export const attentionSelectorSchema = z
	.object({
		groupKey: z.string().min(1).max(1000).optional(),
		alertId: z.string().min(1).max(128).optional(),
	})
	.refine(
		(x) => Boolean(x.groupKey) !== Boolean(x.alertId),
		"Choose exactly one groupKey or alertId",
	);
export const attentionIgnoreSchema = attentionSelectorSchema.safeExtend({
	reason: z.string().trim().max(2000).optional(),
});
export interface AttentionSourceTarget {
	kind:
		| "team_member"
		| "mail_delivery"
		| "automation_run"
		| "workspace"
		| "memory";
	teamId: string | null;
	memberId: string | null;
	projectId: string | null;
	workspaceId: string | null;
	terminalId: string | null;
	terminalLive: boolean;
	fallback: "workspace" | "team" | "automations" | "memory" | null;
	mailDeliveryId: string | null;
	automationId: string | null;
	automationRunId: string | null;
}
export type AttentionSourceInput = Pick<AttentionSourceTarget, "kind"> &
	Partial<Omit<AttentionSourceTarget, "kind" | "terminalLive" | "fallback">>;
export interface AttentionAlertShape extends WatchdogAlertShape {
	groupKey: string;
	severity: "high" | "normal";
	projectId: string | null;
	workspaceId: string | null;
	terminalId: string | null;
	memberId: string | null;
	mailDeliveryId: string | null;
	automationId: string | null;
	automationRunId: string | null;
	ignoredAt: number | null;
	ignoreReason: string | null;
	resolvedAt: number | null;
	source: AttentionSourceTarget;
}
export interface AttentionGroupShape {
	groupKey: string;
	kind: WatchdogAlertShape["kind"];
	severity: "high" | "normal";
	subject: string;
	body: string;
	disposition: "open" | "ignored" | "resolved";
	unread: boolean;
	activeCount: number;
	totalCount: number;
	firstCreatedAt: number;
	latestCreatedAt: number;
	source: AttentionSourceTarget;
	items: AttentionAlertShape[];
}
export interface ButlerBadgeSummary {
	pendingApprovals: number;
	unreadHighFaultGroups: number;
	count: number;
}
