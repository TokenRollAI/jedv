import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { useLingui } from "@lingui/react/macro";
import {
	LuPanelRight,
	LuPanelRightClose,
	LuPanelRightOpen,
} from "react-icons/lu";
import { HotkeyLabel } from "renderer/hotkeys";
export function RightSidebarToggle({
	isOpen,
	disabled = false,
	onToggle,
}: {
	isOpen: boolean;
	disabled?: boolean;
	onToggle(): void;
}) {
	const { t } = useLingui();
	return (
		<Tooltip delayDuration={1000}>
			<TooltipTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={t({ message: "Toggle right sidebar" })}
					aria-pressed={isOpen}
					onClick={onToggle}
					className="no-drag group flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
				>
					<LuPanelRight
						className="size-4 group-hover:hidden"
						strokeWidth={1.5}
					/>
					{isOpen ? (
						<LuPanelRightClose
							className="hidden size-4 group-hover:block"
							strokeWidth={1.5}
						/>
					) : (
						<LuPanelRightOpen
							className="hidden size-4 group-hover:block"
							strokeWidth={1.5}
						/>
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent side="left">
				<HotkeyLabel
					id="TOGGLE_SIDEBAR"
					fallbackLabel={t({ message: "Toggle right sidebar" })}
				/>
			</TooltipContent>
		</Tooltip>
	);
}
