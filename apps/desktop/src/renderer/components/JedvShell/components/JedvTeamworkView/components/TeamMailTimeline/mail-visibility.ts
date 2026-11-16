import type { MailItem } from "../../../../hooks/useTeamwork";
export const isWorkerReport = (body: string) =>
	/^\s*JEDV_WORKER_(DONE|BLOCKED)(?:\r?\n|$)/.test(body);
export const deliveryNeedsAttention = (
	delivery: MailItem["deliveries"][number],
) =>
	delivery.ackedAt == null &&
	(!!delivery.lastError ||
		[
			"uncertain_staged",
			"failed",
			"suppressed_hop_limit",
			"suppressed_budget",
		].includes(delivery.nudgeState));
export const isOverviewMail = (item: MailItem) =>
	item.event.sourceKind === "human" ||
	isWorkerReport(item.event.body) ||
	item.deliveries.some(deliveryNeedsAttention);
