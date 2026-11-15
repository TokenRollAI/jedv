import { formatDateTime } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuEye, LuMail } from "react-icons/lu";
import type { MailItem, TeamMember } from "../../../../../../hooks/useTeamwork";
import { TeamIconButton } from "../../../TeamIconButton";
export function TeamMailRow({
	item,
	members,
	pending,
	readOnly,
	onConsume,
}: {
	item: MailItem;
	members: TeamMember[];
	pending: boolean;
	readOnly: boolean;
	onConsume(id: string, ack: boolean): void;
}) {
	const { t, i18n } = useLingui();
	const [expanded, setExpanded] = useState(false);
	const { event, deliveries } = item;
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
				{total === 1 && deliveries[0] && actions(deliveries[0])}
				{total > 1 && (
					<span className="shrink-0" title={t({ message: "Acknowledged" })}>
						{ackedCount}/{total}
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
					{event.body}
				</span>
				<LuChevronDown
					className={`mt-1 size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
				/>
			</button>
			{expanded && total > 1 && (
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
								{delivery.ackedAt != null
									? t({ message: "Acknowledged" })
									: delivery.readAt != null
										? t({ message: "Read, awaiting acknowledgement" })
										: t({ message: "Unread" })}
							</span>
							{actions(delivery)}
						</div>
					))}
				</div>
			)}
		</article>
	);
}
