import { formatRelativeTime } from "@jedv/i18n/format";
import type { WatchdogAlertShape } from "@jedv/shared/memory";
import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { LuMail, LuTriangleAlert } from "react-icons/lu";
import type { Team } from "../../../../hooks/useTeamwork";
export function ButlerAlertCard({
	alert,
	team,
	pending,
	onRead,
	onOpenTeam,
	onAsk,
}: {
	alert: WatchdogAlertShape;
	team?: Team;
	pending: boolean;
	onRead(): void;
	onOpenTeam?(): void;
	onAsk(): void;
}) {
	const Icon = alert.kind === "mail_unacked" ? LuMail : LuTriangleAlert;
	return (
		<article className="space-y-2 rounded-lg border border-border bg-card p-3">
			<header className="flex min-w-0 items-start gap-2">
				<Icon
					className={`mt-0.5 size-4 shrink-0 ${alert.kind === "mail_unacked" ? "text-muted-foreground" : "text-warning"}`}
				/>
				<h3 className="min-w-0 flex-1 break-words text-[13px] font-medium">
					{alert.subject}
				</h3>
				<time
					dateTime={new Date(alert.createdAt).toISOString()}
					className="shrink-0 text-[10px] text-muted-foreground"
				>
					{formatRelativeTime(alert.createdAt)}
				</time>
			</header>
			{team && (
				<p className="truncate text-xs text-muted-foreground" title={team.name}>
					{team.name}
				</p>
			)}
			<p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
				{alert.body}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{onOpenTeam && (
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="h-7 text-xs"
						onClick={onOpenTeam}
					>
						<Trans>View team</Trans>
					</Button>
				)}
				{alert.readAt == null && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 text-xs text-muted-foreground"
						disabled={pending}
						onClick={onRead}
					>
						<Trans>Mark as read</Trans>
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-7 text-xs text-muted-foreground"
					onClick={onAsk}
				>
					<Trans>Ask Butler</Trans>
				</Button>
			</div>
		</article>
	);
}
