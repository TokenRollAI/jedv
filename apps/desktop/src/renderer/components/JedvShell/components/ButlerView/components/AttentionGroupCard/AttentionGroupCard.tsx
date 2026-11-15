import { formatDateTime, formatRelativeTime } from "@jedv/i18n/format";
import type { AttentionGroupShape } from "@jedv/shared/butler-attention";
import { Badge } from "@jedv/ui/badge";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	LuCircleCheck,
	LuCircleMinus,
	LuMail,
	LuTriangleAlert,
} from "react-icons/lu";
import type { Team } from "../../../../hooks/useTeamwork";
import { useAttentionTitle } from "../../hooks/useAttentionTitle";
export function AttentionGroupCard({
	group,
	team,
	memberName,
	workspaceName,
	projectName,
	automationName,
	pending,
	blocked,
	onRead,
	onIgnore,
	onLocate,
	onAsk,
}: {
	group: AttentionGroupShape;
	team?: Team;
	memberName?: string;
	workspaceName?: string;
	projectName?: string;
	automationName?: string;
	pending: boolean;
	blocked: boolean;
	onRead(): void;
	onIgnore(title: string): void;
	onLocate?(): void;
	onAsk(): void;
}) {
	const { t } = useLingui();
	const Icon = group.kind === "mail_unacked" ? LuMail : LuTriangleAlert;
	const open = group.disposition === "open";
	const title = useAttentionTitle(group);
	const objectName = [automationName, team?.name, memberName]
		.filter(Boolean)
		.join(" / ");
	const location = [projectName, workspaceName].filter(Boolean).join(" / ");
	const sourceLabel = group.source.terminalLive
		? t({ message: "Open terminal" })
		: group.source.fallback === "automations"
			? t({ message: "View run" })
			: group.source.fallback === "memory"
				? t({ message: "Memory" })
				: group.source.fallback === "workspace"
					? t({ message: "Open workspace" })
					: t({ message: "View team" });
	return (
		<article className="space-y-2 rounded-lg border border-border bg-card p-3">
			<header className="flex min-w-0 items-start gap-2">
				<Icon
					className={`mt-0.5 size-4 shrink-0 ${group.severity === "high" && open ? "text-warning" : "text-muted-foreground"}`}
				/>
				<h3 className="min-w-0 flex-1 break-words text-[13px] font-medium">
					{title}
				</h3>
				{!open && (
					<Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
						{group.disposition === "ignored" ? (
							<LuCircleMinus className="size-3" />
						) : (
							<LuCircleCheck className="size-3" />
						)}
						{group.disposition === "ignored"
							? t({ message: "Ignored" })
							: t({ message: "Resolved" })}
					</Badge>
				)}
				<time
					dateTime={new Date(group.latestCreatedAt).toISOString()}
					title={formatDateTime(group.latestCreatedAt)}
					className="shrink-0 text-[10px] text-muted-foreground"
				>
					{formatRelativeTime(group.latestCreatedAt)}
				</time>
			</header>
			{objectName && (
				<p className="truncate text-xs text-foreground/80" title={objectName}>
					{objectName}
				</p>
			)}
			{location && (
				<p
					className="truncate text-[11px] text-muted-foreground"
					title={location}
				>
					{location}
				</p>
			)}

			<details className="text-[11px] text-muted-foreground">
				<summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<Trans>Details</Trans>
				</summary>
				<div className="mt-2 space-y-2">
					<p className="whitespace-pre-wrap break-words">
						{group.subject}
						{"\n"}
						{group.body}
					</p>
					<p className="break-all font-mono">{group.groupKey}</p>
					{group.items.map((item) => (
						<div
							key={item.id}
							className="space-y-1 border-t border-border/60 pt-2"
						>
							<p className="whitespace-pre-wrap break-words">
								{item.subject}
								{"\n"}
								{item.body}
							</p>
							<p>
								{formatDateTime(item.createdAt)} ·{" "}
								{item.resolvedAt != null
									? t({ message: "Resolved" })
									: item.ignoredAt != null
										? t({ message: "Ignored" })
										: item.readAt != null
											? t({ message: "Read" })
											: t({ message: "Unread" })}
							</p>
							{item.ignoreReason && (
								<p className="whitespace-pre-wrap break-words">
									{item.ignoreReason}
								</p>
							)}
						</div>
					))}
				</div>
			</details>
			{blocked && (
				<p role="alert" className="text-[11px] text-destructive">
					<Trans>The result is uncertain. Refresh before deciding again.</Trans>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{onLocate && (
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="h-7 text-xs"
						disabled={pending}
						onClick={onLocate}
					>
						{sourceLabel}
					</Button>
				)}
				{open && group.unread && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 text-xs text-muted-foreground"
						disabled={pending || blocked}
						onClick={onRead}
					>
						<Trans>Mark as read</Trans>
					</Button>
				)}
				{open && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 text-xs text-muted-foreground"
						disabled={pending || blocked}
						onClick={() => onIgnore(title)}
					>
						<Trans>Ignore</Trans>
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
