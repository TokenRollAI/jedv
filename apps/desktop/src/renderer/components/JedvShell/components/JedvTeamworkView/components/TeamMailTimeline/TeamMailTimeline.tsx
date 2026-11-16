import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
}: {
	items: MailItem[];
	members: TeamMember[];
	pending: boolean;
	readOnly: boolean;
	onConsume(id: string, ack: boolean): void;
}) {
	const { t } = useLingui();
	const [diagnostics, setDiagnostics] = useState(false);
	const [inspectId, setInspectId] = useState<string | null>(null);
	const relevant = items.filter(isOverviewMail);
	const visible = diagnostics ? items : relevant;
	return (
		<section aria-label={t({ message: "Team mail" })}>
			<div className="flex flex-wrap items-center justify-between gap-2 py-2">
				<p className="text-xs text-muted-foreground">
					<Trans>
						Agent reports are not verified completion. Mail acknowledgement is
						separate from task acceptance.
					</Trans>
				</p>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					aria-pressed={diagnostics}
					onClick={() => setDiagnostics(!diagnostics)}
				>
					{diagnostics ? (
						<Trans>Show progress and decisions</Trans>
					) : (
						<Trans>Internal mail and diagnostics</Trans>
					)}
				</Button>
			</div>
			{!visible.length && (
				<p className="py-10 text-center text-xs text-muted-foreground">
					<Trans>
						No progress reports or decisions yet. Internal communication is
						available in diagnostics.
					</Trans>
				</p>
			)}
			{visible.map((item) =>
				diagnostics ? (
					<TeamMailRow
						key={item.event.id}
						initiallyExpanded={item.event.id === inspectId}
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
						onInspect={() => {
							setInspectId(item.event.id);
							setDiagnostics(true);
						}}
					/>
				),
			)}
		</section>
	);
}
