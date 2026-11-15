import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@jedv/ui/hover-card";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import type { LinkHoverInfo } from "renderer/lib/terminal/terminal-runtime-registry";
import { modifierLabel } from "../../../JedvFilesView/utils/clickPolicy/modifierLabel";
import type { LinkSettings } from "../../../JedvFilesView/utils/link-policy/types";
import {
	canOpenTerminalLink,
	resolveTerminalLinkAction,
	type TerminalLinkAction,
	type TerminalLinkHandlers,
} from "../../link-actions";
import {
	TERMINAL_LINK_TIERS,
	type TerminalLinkMenuItem,
	terminalLinkActionLabel,
} from "../../link-menu";
import { TerminalLinkMenuItems } from "../TerminalLinkMenuItems";

export function TerminalLinkHover({
	link,
	x,
	y,
	settings,
	handlers,
	items,
	onAction,
	onCopy,
	onEnter,
	onLeave,
}: {
	link: LinkHoverInfo;
	x: number;
	y: number;
	settings: LinkSettings;
	handlers: Pick<TerminalLinkHandlers, "remote" | "onOpenFile" | "onOpenUrl">;
	items: TerminalLinkMenuItem[];
	onAction(action: TerminalLinkAction): void;
	onCopy(): void;
	onEnter(): void;
	onLeave(): void;
}) {
	const { t } = useLingui();
	const [menuOpen, setMenuOpen] = useState(false);
	const text = link.kind === "url" ? link.url : (link.resolvedPath ?? "");
	return (
		<HoverCard open>
			<HoverCardTrigger asChild>
				<span
					aria-hidden
					className="pointer-events-none fixed size-px"
					style={{ left: x, top: y }}
				/>
			</HoverCardTrigger>
			<HoverCardContent
				align="start"
				side="bottom"
				sideOffset={10}
				collisionPadding={12}
				className="max-h-[calc(100vh-24px)] w-96 max-w-[calc(100vw-24px)] overflow-y-auto p-2"
				onMouseEnter={onEnter}
				onMouseLeave={() => {
					if (!menuOpen) onLeave();
				}}
				onFocus={onEnter}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget) && !menuOpen)
						onLeave();
				}}
			>
				<div className="flex items-start gap-2 border-b border-border pb-2">
					<div
						className="max-h-24 min-w-0 flex-1 overflow-y-auto break-all text-xs font-mono"
						title={text}
					>
						{text}
						{link.kind === "file" && link.row !== undefined && (
							<span className="text-muted-foreground">
								:{link.row}
								{link.col !== undefined ? `:${link.col}` : ""}
							</span>
						)}
					</div>
					<Button
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						onClick={onCopy}
						aria-label={
							link.kind === "url"
								? t({ message: "Copy Link" })
								: t({ message: "Copy Path" })
						}
					>
						<Copy className="size-3" />
					</Button>
				</div>
				<div className="py-1">
					{TERMINAL_LINK_TIERS.map(({ tier, event }) => {
						const action = resolveTerminalLinkAction(
							link,
							settings,
							event,
							handlers.remote,
						);
						return (
							<button
								key={tier}
								type="button"
								disabled={
									action === null ||
									!canOpenTerminalLink(link, action, handlers)
								}
								className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
								onClick={() => {
									if (action) onAction(action);
								}}
							>
								<span>
									{action === null
										? t({ message: "Do nothing" })
										: terminalLinkActionLabel(link, action)}
								</span>
								<span className="shrink-0 text-muted-foreground">
									{modifierLabel(tier)}
								</span>
							</button>
						);
					})}
				</div>
				<DropdownMenu
					open={menuOpen}
					onOpenChange={(open) => {
						setMenuOpen(open);
						if (open) onEnter();
						else onLeave();
					}}
				>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-full justify-between border-t border-border"
						>
							<Trans>Open in</Trans>
							<ChevronDown className="size-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="max-h-80 overflow-y-auto"
					>
						<TerminalLinkMenuItems items={items} />
					</DropdownMenuContent>
				</DropdownMenu>
			</HoverCardContent>
		</HoverCard>
	);
}
