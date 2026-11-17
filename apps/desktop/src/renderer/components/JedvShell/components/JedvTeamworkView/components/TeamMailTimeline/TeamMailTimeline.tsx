import { Trans, useLingui } from "@lingui/react/macro";
import { LuInbox } from "react-icons/lu";
import type { MailItem, TeamMember } from "../../../../hooks/useTeamwork";
import { TeamMailRow } from "./components/TeamMailRow";
import { TeamProgressRow } from "./components/TeamProgressRow";
import { isOverviewMail } from "./mail-visibility";
export function TeamMailTimeline({
	items,
	members,
	pending,
	readOnly,
	onConsume,
	mode = "all",
	expandedId = null,
	onInspect,
}: {
	items: MailItem[];
	members: TeamMember[];
	pending: boolean;
	readOnly: boolean;
	onConsume(id: string, ack: boolean): void;
	mode?: "all" | "reports";
	expandedId?: string | null;
	onInspect?(eventId: string): void;
}) {
	const { t } = useLingui();
	const visible = mode === "reports" ? items.filter(isOverviewMail) : items;
	return (
		<section aria-label={t({ message: "Team mail" })}>
			{!visible.length && (
				<div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-2.5 py-14 text-center">
					<span className="grid size-9 place-items-center rounded-xl border border-border/60 bg-card/50 text-muted-foreground/75">
						<LuInbox className="size-4" />
					</span>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{mode === "reports" ? (
							<Trans>
								No key reports or instructions yet. Check All activity for full
								worker mail.
							</Trans>
						) : (
							<Trans>No team activity yet.</Trans>
						)}
					</p>
				</div>
			)}
			{visible.map((item) =>
				mode === "all" ? (
					<TeamMailRow
						key={item.event.id}
						initiallyExpanded={item.event.id === expandedId}
						item={item}
						members={members}
						pending={pending}
						readOnly={readOnly}
						onConsume={onConsume}
					/>
				) : (
					<TeamProgressRow
						key={item.event.id}
						item={item}
						members={members}
						onInspect={() => onInspect?.(item.event.id)}
					/>
				),
			)}
		</section>
	);
}
