import { Badge } from "@jedv/ui/badge";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MailItem, TeamMember } from "../../../../../../hooks/useTeamwork";
import { deliveryNeedsAttention, isWorkerReport } from "../../mail-visibility";
export function TeamProgressRow({
	item,
	members,
	onInspect,
}: {
	item: MailItem;
	members: TeamMember[];
	onInspect(): void;
}) {
	const { t } = useLingui();
	const { event } = item;
	const report = isWorkerReport(event.body);
	const blocked = /^\s*JEDV_WORKER_BLOCKED(?:\r?\n|$)/.test(event.body);
	const exception = item.deliveries.some(deliveryNeedsAttention);
	const first = event.body.trim().split(/\r?\n/)[0] ?? "";
	const summary = report
		? event.body.match(/^(?:summary|reason):\s*(.+)$/m)?.[1]
		: event.subject ||
			(first.length <= 160 &&
			!/(?:task:|workspace:|dedupe|\/Users\/|```)/i.test(first)
				? first
				: undefined);
	const memberName = (id: string) =>
		members.find((member) => member.id === id)?.name ?? `#${id.slice(0, 8)}`;
	const author =
		event.sourceKind === "human"
			? t({ message: "You" })
			: (members.find((member) => member.id === event.sourceId)?.name ??
				t({ message: "Agent" }));
	const recipients = [
		...new Set(
			item.deliveries.map((delivery) => memberName(delivery.recipientMemberId)),
		),
	].join(", ");
	return (
		<article className="space-y-1 border-b border-border py-3">
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				{event.sourceKind === "human" ? (
					<Badge
						variant="secondary"
						className="h-4 max-w-64 truncate px-1.5 text-[10px] font-normal"
					>
						{t({ message: "You" })} → {recipients || t({ message: "Team" })}
					</Badge>
				) : (
					<span className="max-w-48 truncate">{author}</span>
				)}
				<span>
					{blocked
						? t({ message: "Agent reported a blocker" })
						: report
							? t({ message: "Agent progress report" })
							: t({ message: "Human instruction" })}
				</span>
			</div>
			<p className="line-clamp-2 break-words text-xs leading-5">
				{summary
					? summary.slice(0, 200) + (summary.length > 200 ? "…" : "")
					: t({ message: "Instructions are available in the original mail." })}
			</p>
			{exception && (
				<p role="alert" className="text-xs text-destructive">
					<Trans>
						Mail delivery needs attention. View original mail to inspect the
						delivery.
					</Trans>
				</p>
			)}
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-6 px-0 text-[11px] text-muted-foreground"
				onClick={onInspect}
			>
				<Trans>View original mail</Trans>
			</Button>
		</article>
	);
}
