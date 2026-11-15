import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import { Button } from "@jedv/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@jedv/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { Trans } from "@lingui/react/macro";
import { Play, Settings, TerminalSquare } from "lucide-react";
import { useRef } from "react";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { HotkeyId } from "renderer/hotkeys/registry";
export function PresetBarItem({
	preset,
	icon,
	index,
	disabled,
	onRun,
	onEdit,
}: {
	preset: TerminalPreset;
	icon?: string;
	index: number;
	disabled: boolean;
	onRun(): void;
	onEdit(): void;
}) {
	const shortcut = useHotkeyDisplay(
		`OPEN_PRESET_${Math.min(index + 1, 9)}` as HotkeyId,
	).text;
	const next = useRef<(() => void) | null>(null);
	return (
		<ContextMenu>
			<Tooltip delayDuration={700}>
				<TooltipTrigger asChild>
					<ContextMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							className="h-6 max-w-40 min-w-0 shrink-0 gap-2 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground"
							onClick={onRun}
						>
							{icon ? (
								<img
									src={icon}
									alt=""
									className="size-3.5 shrink-0 object-contain opacity-90"
								/>
							) : (
								<TerminalSquare className="size-3.5" />
							)}
							<span className="truncate">{preset.name}</span>
						</Button>
					</ContextMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-80 break-words">
					{preset.description || preset.name}
					{index < 9 && shortcut !== "Unassigned" && (
						<span className="ml-2 text-muted-foreground">{shortcut}</span>
					)}
				</TooltipContent>
			</Tooltip>
			<ContextMenuContent
				onCloseAutoFocus={(event) => {
					if (!next.current) return;
					event.preventDefault();
					const action = next.current;
					next.current = null;
					requestAnimationFrame(action);
				}}
			>
				<ContextMenuItem
					disabled={disabled}
					onSelect={() => {
						next.current = onRun;
					}}
				>
					<Play className="size-4" />
					<Trans>Run</Trans>
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => {
						next.current = onEdit;
					}}
				>
					<Settings className="size-4" />
					<Trans>Edit</Trans>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
