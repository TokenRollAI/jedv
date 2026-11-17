import { Kbd } from "@jedv/ui/kbd";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
	LuClock,
	LuGauge,
	LuGitPullRequest,
	LuLayers,
	LuPlus,
	LuSearch,
	LuSettings,
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
	inbox,
	footerHost,
	children,
}: {
	surface: JedvSurface;
	usageVisible: boolean;
	onSelect(surface: JedvSurface): void;
	onSearch(): void;
	onNewWorkspace(): void;
	canCreateWorkspace: boolean;
	inbox?: ReactNode;
	footerHost?: ReactNode;
	children?: ReactNode;
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
				className="shrink-0 space-y-0.5 border-b border-sidebar-border px-2.5 pt-1 pb-2.5"
			>
				<button
					type="button"
					disabled={!canCreateWorkspace}
					onClick={onNewWorkspace}
					className="group mb-1.5 flex h-[30px] w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/65 px-2 text-[13px] font-medium text-sidebar-foreground shadow-2xs transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
				>
					<LuPlus
						className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-sidebar-foreground"
						strokeWidth={2}
					/>
					<span className="flex-1 truncate text-left whitespace-nowrap">
						<Trans>New Workspace</Trans>
					</span>
					{newWorkspaceKey !== "Unassigned" && (
						<Kbd className="h-[18px] px-1 text-[10px]">{newWorkspaceKey}</Kbd>
					)}
				</button>
				<button
					type="button"
					onClick={onSearch}
					className="group flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<LuSearch className="size-4 shrink-0" />
					<span className="flex-1 truncate">
						<Trans>Search</Trans>
					</span>
					{searchKey !== "Unassigned" && (
						<Kbd className="h-[18px] px-1 text-[10px] opacity-75 group-hover:opacity-100">
							{searchKey}
						</Kbd>
					)}
				</button>
				{inbox}
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-current={surface === item.id ? "page" : undefined}
						className={`flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${surface === item.id ? "bg-fill-selected font-medium text-foreground" : "text-muted-foreground hover:bg-fill-hover hover:text-foreground"}`}
						onClick={() => onSelect(item.id)}
					>
						<item.icon className="size-4 shrink-0" />
						<span className="truncate">{item.label}</span>
					</button>
				))}
			</nav>
			{children}
			<div className="flex h-10 shrink-0 items-center justify-between gap-1 border-t border-sidebar-border px-3">
				{footerHost}
				<button
					type="button"
					aria-label={t({ message: "Settings" })}
					className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground"
					onClick={() => onSelect("settings")}
				>
					<LuSettings className="size-4" />
				</button>
			</div>
		</>
	);
}
