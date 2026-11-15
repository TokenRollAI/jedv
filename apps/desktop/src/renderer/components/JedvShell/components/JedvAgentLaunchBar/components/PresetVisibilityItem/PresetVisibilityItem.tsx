import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import { DropdownMenuItem, DropdownMenuShortcut } from "@jedv/ui/dropdown-menu";
import { Eye, EyeOff, TerminalSquare } from "lucide-react";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { HotkeyId } from "renderer/hotkeys/registry";
export function PresetVisibilityItem({
	preset,
	icon,
	index,
	disabled,
	onToggle,
}: {
	preset: TerminalPreset;
	icon?: string;
	index: number;
	disabled: boolean;
	onToggle(): void;
}) {
	const shortcut = useHotkeyDisplay(
		`OPEN_PRESET_${Math.max(1, Math.min(index + 1, 9))}` as HotkeyId,
	).text;
	return (
		<DropdownMenuItem
			disabled={disabled}
			onSelect={(event) => {
				event.preventDefault();
				onToggle();
			}}
		>
			{icon ? (
				<img
					src={icon}
					alt=""
					className="size-4 shrink-0 object-contain opacity-90"
				/>
			) : (
				<TerminalSquare className="size-4" />
			)}
			<span className="min-w-0 flex-1 truncate">{preset.name}</span>
			{index >= 0 && index < 9 && shortcut !== "Unassigned" && (
				<DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
			)}
			{preset.pinnedToBar === false ? (
				<EyeOff className="size-3.5 text-muted-foreground" />
			) : (
				<Eye className="size-3.5" />
			)}
		</DropdownMenuItem>
	);
}
