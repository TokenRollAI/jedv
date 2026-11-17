import { Badge } from "@jedv/ui/badge";
import { Trans, useLingui } from "@lingui/react/macro";
import { ButlerIcon } from "../ButlerIcon";
export function ButlerNavigation({
	active,
	count,
	onSelect,
}: {
	active: boolean;
	count: number;
	onSelect(): void;
}) {
	const { t } = useLingui();
	return (
		<button
			type="button"
			aria-current={active ? "page" : undefined}
			title={t({ message: "Inbox" })}
			onClick={onSelect}
			className={`flex h-[30px] w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${active ? "bg-fill-selected font-medium text-foreground" : "text-muted-foreground hover:bg-fill-hover hover:text-foreground"}`}
		>
			<ButlerIcon className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate">
				<Trans>Inbox</Trans>
			</span>
			{count > 0 && (
				<Badge
					title={t({
						message: "Pending approvals and unread important faults",
					})}
					variant="secondary"
					className="h-[18px] min-w-[18px] rounded px-1 font-mono text-[10.5px] tabular-nums"
				>
					{count > 99 ? "99+" : count}
				</Badge>
			)}
		</button>
	);
}
