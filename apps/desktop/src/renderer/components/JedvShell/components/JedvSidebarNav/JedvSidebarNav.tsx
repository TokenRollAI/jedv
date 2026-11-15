import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
	LuClock,
	LuGauge,
	LuGitPullRequest,
	LuLayers,
	LuPlus,
	LuSearch,
	LuSettings2,
	LuSparkles,
} from "react-icons/lu";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { JedvSurface } from "../../parity-types";
export function JedvSidebarNav({
	surface,
	usageVisible,
	onSelect,
	onSearch,
	onNewWorkspace,
	canCreateWorkspace,
	footerHost,
	islandEnabled,
	onIslandChange,
}: {
	surface: JedvSurface;
	usageVisible: boolean;
	onSelect(surface: JedvSurface): void;
	onSearch(): void;
	onNewWorkspace(): void;
	canCreateWorkspace: boolean;
	footerHost?: ReactNode;
	islandEnabled: boolean;
	onIslandChange(enabled: boolean): void;
}) {
	const { t } = useLingui();
	const newWorkspaceKey = useHotkeyDisplay("NEW_WORKSPACE").text;
	const searchKey = useHotkeyDisplay("OPEN_COMMAND_PALETTE").text;
	const items = [
		{
			id: "board" as const,
			label: t({ message: "Workspaces" }),
			icon: LuLayers,
		},
		{
			id: "automations" as const,
			label: t({ message: "Automations" }),
			icon: LuClock,
		},
		{
			id: "pull-requests" as const,
			label: t({ message: "Pull Requests" }),
			icon: LuGitPullRequest,
		},
		...(usageVisible
			? [
					{
						id: "usage" as const,
						label: t({ message: "Usage" }),
						icon: LuGauge,
					},
				]
			: []),
	];
	return (
		<>
			<nav
				aria-label={t({ message: "Workspace navigation" })}
				className="space-y-0.5 border-b border-sidebar-border px-2 pb-3"
			>
				<button
					type="button"
					disabled={!canCreateWorkspace}
					onClick={onNewWorkspace}
					className="group flex h-7 w-full items-center gap-2 rounded-md bg-fill-hover/60 [.light_&]:bg-fill-hover px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-fill-selected hover:text-foreground disabled:opacity-50"
				>
					<span className="flex size-5 shrink-0 items-center justify-center rounded bg-fill-selected">
						<LuPlus className="size-3" strokeWidth={2} />
					</span>
					<span className="flex-1 truncate text-left whitespace-nowrap">
						<Trans>New Workspace</Trans>
					</span>
					{newWorkspaceKey !== "Unassigned" && (
						<span className="text-[10px] font-normal text-muted-foreground/60">
							{newWorkspaceKey}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={onSearch}
					className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground"
				>
					<LuSearch className="size-4" />
					<Trans>Search</Trans>
					<span className="ml-auto text-[10px] font-normal text-muted-foreground/60">
						{searchKey}
					</span>
				</button>
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-current={surface === item.id ? "page" : undefined}
						className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors ${surface === item.id ? "bg-fill-selected text-foreground" : "text-muted-foreground hover:bg-fill-hover hover:text-foreground"}`}
						onClick={() => onSelect(item.id)}
					>
						<item.icon className="size-4" />
						{item.label}
					</button>
				))}
			</nav>
			<div className="order-last flex h-10 shrink-0 items-center justify-between gap-1 border-t border-sidebar-border px-3">
				{footerHost}
				<button
					type="button"
					aria-pressed={islandEnabled}
					title={t({
						message:
							"Open agent activity from the menu bar. The panel closes when it loses focus or when you press Escape.",
					})}
					className="flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] text-muted-foreground hover:bg-fill-hover"
					onClick={() => onIslandChange(!islandEnabled)}
				>
					<LuSparkles className="size-3" />
					<span className={footerHost ? "sr-only" : undefined}>
						<Trans>Menu bar activity</Trans>
					</span>
					<span
						className={`size-1 rounded-full ${islandEnabled ? "bg-success" : "bg-muted-foreground"}`}
					/>
				</button>
				<button
					type="button"
					aria-label={t({ message: "Settings" })}
					className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-fill-hover"
					onClick={() => onSelect("settings")}
				>
					<LuSettings2 className="size-4" />
				</button>
			</div>
		</>
	);
}
