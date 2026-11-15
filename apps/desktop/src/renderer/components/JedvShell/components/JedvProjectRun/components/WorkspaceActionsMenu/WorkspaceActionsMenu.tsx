import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { useRunAfterMenuClose } from "@jedv/ui/hooks/use-run-after-menu-close";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	Ellipsis,
	FolderOpen,
	Play,
	Settings,
	SlidersHorizontal,
	Square,
	Terminal,
	X,
} from "lucide-react";
import { type ReactNode, type RefObject, useRef } from "react";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { WorkspaceOpenInItems } from "../WorkspaceOpenInItems";

export interface WorkspaceMenuContext {
	title: string;
	anchorRef: RefObject<HTMLButtonElement | null>;
	onOpenFiles(): void;
	onOpenAgent(): void;
	pendingApprovals: number;
	onForwardPorts?(): void;
	worktreePath?: string;
	remote?: boolean;
}

export function WorkspaceActionsMenu({
	worktreePath,
	remote,
	anchorRef,
	onOpenFiles,
	onOpenAgent,
	onForwardPorts,
	pendingApprovals,
	definition,
	isRunning,
	isPending,
	hasTerminal,
	canForceStop,
	onToggle,
	onConfigure,
	onOpen,
	onRestart,
	onNew,
	onForceStop,
	status,
	error,
}: WorkspaceMenuContext & {
	definition: { commands: string[] } | null;
	isRunning: boolean;
	isPending: boolean;
	hasTerminal: boolean;
	canForceStop: boolean;
	onToggle(): void | Promise<void>;
	onConfigure(): void;
	onOpen(): void;
	onRestart(): void;
	onNew(): void;
	onForceStop(): void;
	status?: ReactNode;
	error?: string;
}) {
	const { t } = useLingui();
	const { runAfterClose, onCloseAutoFocus } = useRunAfterMenuClose();
	const pendingAction = useRef(false);
	const defer = (action: () => void) => {
		pendingAction.current = true;
		runAfterClose(() => {
			anchorRef.current?.focus();
			action();
		});
	};
	const runHotkey = useHotkeyDisplay("RUN_WORKSPACE_COMMAND").text;
	const hasCommand = (definition?.commands.length ?? 0) > 0;
	const RunIcon = isRunning ? Square : hasCommand ? Play : Settings;
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							ref={anchorRef}
							type="button"
							aria-label={t({ message: "More actions" })}
							className="no-drag relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-foreground/15 aria-expanded:text-foreground"
						>
							<Ellipsis className="size-4" strokeWidth={1.5} />
							{(isRunning || pendingApprovals > 0 || error) && (
								<span
									className={`absolute right-1 top-1 size-1.5 rounded-full ${error || pendingApprovals ? "bg-warning" : "bg-emerald-400"}`}
								/>
							)}
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<Trans>More actions</Trans>
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				className="min-w-56 max-w-[calc(100vw-1rem)]"
				onCloseAutoFocus={(event) => {
					if (!pendingAction.current) return;
					pendingAction.current = false;
					onCloseAutoFocus(event);
				}}
			>
				{worktreePath && !remote && (
					<WorkspaceOpenInItems path={worktreePath} onRun={defer} />
				)}
				{status && (
					<div className="px-2 pb-1 text-[11px] text-muted-foreground">
						{status}
					</div>
				)}
				{error && (
					<p
						role="alert"
						className="break-words px-2 pb-1 text-xs text-destructive"
					>
						{error}
					</p>
				)}
				<DropdownMenuItem
					disabled={isPending}
					onSelect={() =>
						defer(() => {
							if (!hasCommand && !isRunning) onConfigure();
							else void onToggle();
						})
					}
				>
					<RunIcon className="size-4" />
					{isRunning ? (
						<Trans>Stop</Trans>
					) : hasCommand ? (
						<Trans>Run</Trans>
					) : (
						<Trans>Set Run</Trans>
					)}
					{(isRunning || hasCommand) && runHotkey !== "Unassigned" && (
						<DropdownMenuShortcut>{runHotkey}</DropdownMenuShortcut>
					)}
				</DropdownMenuItem>
				{hasTerminal && (
					<>
						<DropdownMenuItem
							disabled={isPending}
							onSelect={() => defer(onOpen)}
						>
							<Terminal className="size-4" />
							<Trans>Open Terminal</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={isPending}
							onSelect={() => defer(onRestart)}
						>
							<Trans>Restart</Trans>
						</DropdownMenuItem>
					</>
				)}
				{hasCommand && (
					<>
						<DropdownMenuItem
							disabled={isPending}
							onSelect={() => defer(onNew)}
						>
							<Terminal className="size-4" />
							<Trans>Run in new terminal</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => defer(onConfigure)}>
							<Settings className="size-4" />
							<Trans>Configure</Trans>
						</DropdownMenuItem>
					</>
				)}
				{canForceStop && (
					<DropdownMenuItem
						className="text-destructive focus:text-destructive"
						onSelect={() => defer(onForceStop)}
					>
						<X className="size-4 text-destructive" />
						<Trans>Force Stop</Trans>
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				{onForwardPorts && (
					<DropdownMenuItem onSelect={() => defer(onForwardPorts)}>
						<Trans>Forward port…</Trans>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={() => defer(onOpenFiles)}>
					<FolderOpen className="size-4" />
					<Trans>Files</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => defer(onOpenAgent)}>
					<SlidersHorizontal className="size-4" />
					<Trans>Agent Control</Trans>
					{pendingApprovals > 0 && (
						<span className="ml-auto rounded bg-warning px-1 text-[10px] text-warning-foreground">
							{pendingApprovals}
						</span>
					)}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
