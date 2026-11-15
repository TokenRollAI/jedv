import { Trans, useLingui } from "@lingui/react/macro";
import type { MailItem, TeamMember } from "../../../../hooks/useTeamwork";
import { TeamMailRow } from "./components/TeamMailRow";
export function TeamMailTimeline({
	items,
	members,
	pending,
	readOnly,
	onConsume,
}: {
	items: MailItem[];
	members: TeamMember[];
	pending: boolean;
	readOnly: boolean;
	onConsume(id: string, ack: boolean): void;
}) {
	const { t } = useLingui();
	return (
		<section aria-label={t({ message: "Team mail" })}>
			{!items.length && (
				<p className="py-10 text-center text-xs text-muted-foreground">
					<Trans>No team mail yet</Trans>
				</p>
			)}
			{items.map((item) => (
				<TeamMailRow
					key={item.event.id}
					item={item}
					members={members}
					pending={pending}
					readOnly={readOnly}
					onConsume={onConsume}
				/>
			))}
		</section>
	);
}
