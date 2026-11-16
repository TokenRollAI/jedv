import { formatDateTime } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuEye, LuMail } from "react-icons/lu";
import type { MailItem, TeamMember } from "../../../../../../hooks/useTeamwork";
import { TeamIconButton } from "../../../TeamIconButton";
import { deliveryNeedsAttention, isWorkerReport } from "../../mail-visibility";
export function TeamMailRow({
	item,
	initiallyExpanded = false,
	members,
	pending,
	readOnly,
	onConsume,
}: {
	item: MailItem;
	initiallyExpanded?: boolean;
	members: TeamMember[];
	pending: boolean;
	readOnly: boolean;
	onConsume(id: string, ack: boolean): void;
}) {
	const { t, i18n } = useLingui();
	const [expanded, setExpanded] = useState(initiallyExpanded);
	const { event, deliveries } = item;
	const requiresAck = event.requiresAck !== false;
	const report = isWorkerReport(event.body)
		? event.body.match(/^(?:summary|reason):\s*(.+)$/m)?.[1]
		: undefined;
	const deliveryErrors = deliveries.filter(deliveryNeedsAttention);
	const deliveryState = (delivery: MailItem["deliveries"][number]) => {
		if (delivery.ackedAt != null) return t({ message: "Acknowledged" });
		if (delivery.nudgeState === "uncertain_staged")
			return t({ message: "Delivery uncertain" });
		if (delivery.nudgeState === "failed")
			return t({ message: "Delivery failed" });
		if (
			delivery.nudgeState === "suppressed_hop_limit" ||
			delivery.nudgeState === "suppressed_budget"
		)
			return t({ message: "Automatic delivery paused" });
		if (delivery.readAt != null)
			return requiresAck
				? t({ message: "Read, awaiting acknowledgement" })
				: t({ message: "Read" });
		if (delivery.nudgeState === "inflight") return t({ message: "Delivering" });
		if (delivery.nudgeState === "nudged")
			return t({ message: "Agent notified, awaiting consumption" });
		if (delivery.nudgeState === "pending") return t({ message: "Queued" });
		return t({ message: "Unread" });
	};

	const name = (id: string) =>
		members.find((member) => member.id === id)?.name ?? `#${id.slice(0, 8)}`;
	const ackedCount = deliveries.filter(
			(delivery) => delivery.ackedAt != null,
		).length,
		total = deliveries.length;
	const actions = (delivery: MailItem["deliveries"][number]) => (
		<div className="flex shrink-0 items-center gap-1">
			{delivery.ackedAt != null ? (
				<span className="text-[11px] text-muted-foreground">
					<Trans>Acknowledged</Trans>
				</span>
			) : (
				<>
					{delivery.readAt == null && (
						<TeamIconButton
							label={t({
								message: `Mark mail to ${name(delivery.recipientMemberId)} as read`,
							})}
							className="size-6"
							disabled={pending || readOnly}
							onClick={() => onConsume(delivery.id, false)}
						>
							<LuEye className="size-3.5" />
						</TeamIconButton>
					)}
					{requiresAck && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-6 px-1.5 text-[11px]"
							disabled={pending || readOnly}
							aria-label={t({
								message: `Acknowledge mail to ${name(delivery.recipientMemberId)}`,
							})}
							onClick={() => onConsume(delivery.id, true)}
						>
							<Trans>Confirm receipt</Trans>
						</Button>
					)}
				</>
			)}
		</div>
	);
	return (
		<article className="border-b border-border py-2">
			<div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
				<LuMail className="size-3.5 shrink-0" title={event.type} />
				<span className="min-w-0 flex-1 truncate">
					{event.sourceKind === "human"
						? t({ message: "You" })
						: name(event.sourceId)}{" "}
					→{" "}
					{[
						...new Set(
							deliveries.map((delivery) => name(delivery.recipientMemberId)),
						),
					].join(", ")}
				</span>
				{total === 1 && !expanded && deliveries[0] && (
					<span className="shrink-0">{deliveryState(deliveries[0])}</span>
				)}
				{total > 1 && (
					<span
						className="shrink-0"
						title={
							requiresAck
								? t({ message: "Acknowledged" })
								: t({ message: "Read" })
						}
					>
						{requiresAck
							? ackedCount
							: deliveries.filter((delivery) => delivery.readAt != null).length}
						/{total}
					</span>
				)}
				<time
					className="shrink-0 text-[10px]"
					dateTime={new Date(event.createdAt).toISOString()}
					title={formatDateTime(event.createdAt)}
				>
					{new Date(event.createdAt).toLocaleTimeString(i18n.locale, {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</time>
			</div>
			<button
				type="button"
				aria-expanded={expanded}
				aria-label={
					expanded
						? t({ message: "Collapse message" })
						: t({ message: "Expand message" })
				}
				className="mt-1 flex w-full min-w-0 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => setExpanded(!expanded)}
			>
				<span
					className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5 ${expanded ? "" : "line-clamp-2"}`}
				>
					{event.subject && (
						<strong className="mr-2 font-medium">{event.subject}</strong>
					)}
					{expanded ? event.body : (report ?? event.body)}
				</span>
				<LuChevronDown
					className={`mt-1 size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
				/>
			</button>
			{deliveryErrors.map((delivery) => (
				<p
					key={delivery.id}
					role="alert"
					className="mt-2 break-words text-xs text-destructive"
				>
					{delivery.nudgeState === "uncertain_staged" ? (
						<Trans>
							Delivery outcome is uncertain. Inspect the terminal before
							retrying.
						</Trans>
					) : (
						<Trans>
							Mail delivery needs attention. Open diagnostics to inspect the
							delivery.
						</Trans>
					)}
				</p>
			))}
			{expanded && total > 0 && (
				<div className="mt-2 space-y-1 border-t border-border/60 pt-2">
					{deliveries.map((delivery) => (
						<div
							key={delivery.id}
							className="flex min-w-0 items-center gap-2 text-[11px]"
						>
							<span
								className="min-w-0 flex-1 truncate"
								title={delivery.recipientMemberId}
							>
								{name(delivery.recipientMemberId)}
							</span>
							<span className="text-muted-foreground">
								{deliveryState(delivery)}
							</span>
							{actions(delivery)}
						</div>
					))}
				</div>
			)}
		</article>
	);
}
