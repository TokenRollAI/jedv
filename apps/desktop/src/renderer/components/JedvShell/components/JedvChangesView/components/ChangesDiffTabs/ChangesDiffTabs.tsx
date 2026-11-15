import { Button } from "@jedv/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@jedv/ui/context-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import type { ChangeSelection } from "../../types";
export const changeKey = (change: ChangeSelection) =>
	`${change.category}:${change.path}`;
export function ChangesDiffTabs({
	tabs,
	selected,
	onSelect,
	onClose,
}: {
	tabs: ChangeSelection[];
	selected: ChangeSelection | null;
	onSelect(tab: ChangeSelection): void;
	onClose(keys: string[]): void;
}) {
	const { t } = useLingui();
	return (
		<div
			role="tablist"
			aria-label={t({ message: "Changes" })}
			className="flex h-8 shrink-0 overflow-x-auto border-b"
		>
			{tabs.map((tab, index) => (
				<ContextMenu key={changeKey(tab)}>
					<ContextMenuTrigger asChild>
						<div
							className={`flex shrink-0 items-center border-r px-2 text-xs ${selected && changeKey(selected) === changeKey(tab) ? "bg-fill-selected" : "text-muted-foreground"}`}
						>
							<button
								type="button"
								role="tab"
								aria-selected={
									!!selected && changeKey(selected) === changeKey(tab)
								}
								className="h-full px-1"
								title={tab.path}
								onClick={() => onSelect(tab)}
								onKeyDown={(event) => {
									const next =
										event.key === "ArrowRight"
											? (index + 1) % tabs.length
											: event.key === "ArrowLeft"
												? (index + tabs.length - 1) % tabs.length
												: undefined;
									if (next !== undefined) {
										event.preventDefault();
										onSelect(tabs[next]);
										(
											event.currentTarget.parentElement?.parentElement?.children[
												next
											]?.querySelector("[role=tab]") as HTMLElement | null
										)?.focus();
									}
								}}
							>
								{tab.path.split("/").pop()}
							</button>
							<Button
								variant="ghost"
								size="icon"
								className="size-5"
								aria-label={t({ message: "Close" })}
								onClick={() => onClose([changeKey(tab)])}
							>
								<X className="size-3" />
							</Button>
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem onSelect={() => onClose([changeKey(tab)])}>
							<X />
							<Trans>Close</Trans>
						</ContextMenuItem>
						<ContextMenuItem
							disabled={tabs.length < 2}
							onSelect={() =>
								onClose(
									tabs
										.filter((item) => changeKey(item) !== changeKey(tab))
										.map(changeKey),
								)
							}
						>
							<X />
							<Trans>Close Others</Trans>
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem onSelect={() => onClose(tabs.map(changeKey))}>
							<X />
							<Trans>Close All</Trans>
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			))}
		</div>
	);
}
