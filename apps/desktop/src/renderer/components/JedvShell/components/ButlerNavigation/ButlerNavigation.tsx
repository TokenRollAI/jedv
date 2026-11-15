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
		<div className="shrink-0 px-2 py-2">
			<button
				type="button"
				aria-current={active ? "page" : undefined}
				title={t({ message: "Butler" })}
				onClick={onSelect}
				className={`flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-fill-selected text-foreground" : "text-muted-foreground hover:bg-fill-hover hover:text-foreground"}`}
			>
				<ButlerIcon className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 truncate">
					<Trans>Butler</Trans>
				</span>
				{count > 0 && (
					<Badge
						title={t({
							message: "Pending approvals and unread important faults",
						})}
						variant="secondary"
						className="h-4 min-w-4 px-1 text-[10px] tabular-nums"
					>
						{count > 99 ? "99+" : count}
					</Badge>
				)}
			</button>
		</div>
	);
}
