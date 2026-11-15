import { useLingui } from "@lingui/react/macro";
import {
	LuArrowLeft,
	LuArrowRight,
	LuPanelLeftClose,
	LuPanelLeftOpen,
} from "react-icons/lu";
import logo from "renderer/assets/jedv-logo.svg";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { ProjectActionKind } from "../JedvProjectActions";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
} from "../WindowChrome";
export function JedvSidebarHeader({
	collapsed,
	height = 44,
	onToggle,
	canGoBack = false,
	canGoForward = false,
	onBack,
	onForward,
}: {
	host: string;
	connected: boolean;
	collapsed: boolean;
	height?: 44 | 48;
	onToggle(): void;
	onLocal(): void;
	onConnect(): void;
	onRestart(): void;
	canGoBack?: boolean;
	canGoForward?: boolean;
	onBack?(): void;
	onForward?(): void;
	onProjectAction(kind: ProjectActionKind): void;
}) {
	const { t } = useLingui();
	const sidebarShortcut = useHotkeyDisplay("TOGGLE_WORKSPACE_SIDEBAR").text;

	return (
		<div className="shrink-0">
			<WindowChrome height={height} className="pr-2">
				<WindowChromeLeading leftmost expand={false} />
				<WindowChromeControls className="min-w-0 pl-2">
					<button
						type="button"
						aria-label={t({ message: "Go Back" })}
						disabled={!canGoBack}
						onClick={onBack}
						className="no-drag mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-fill-hover disabled:opacity-30"
					>
						<LuArrowLeft className="size-3.5" />
					</button>
					<button
						type="button"
						aria-label={t({ message: "Go Forward" })}
						disabled={!canGoForward}
						onClick={onForward}
						className="no-drag mr-2 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-fill-hover disabled:opacity-30"
					>
						<LuArrowRight className="size-3.5" />
					</button>
					<img src={logo} alt="" className="mr-1.5 size-4 shrink-0" />
					<span className="truncate text-xs font-medium">Jedv</span>
				</WindowChromeControls>
				<div className="drag min-w-2 flex-1" />
				<WindowChromeControls className="shrink-0">
					<button
						type="button"
						title={`${t({ message: "Toggle Sidebar" })}${sidebarShortcut === "Unassigned" ? "" : ` (${sidebarShortcut})`}`}
						aria-label={t({ message: "Toggle Sidebar" })}
						className="no-drag grid size-7 place-items-center rounded text-muted-foreground hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
						onClick={onToggle}
					>
						{collapsed ? (
							<LuPanelLeftOpen className="size-3.5" />
						) : (
							<LuPanelLeftClose className="size-3.5" />
						)}
					</button>
				</WindowChromeControls>
			</WindowChrome>
		</div>
	);
}
