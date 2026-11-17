import { Button } from "@jedv/ui/button";
import { Kbd } from "@jedv/ui/kbd";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	LuFolderOpen,
	LuGitCompareArrows,
	LuNetwork,
	LuPlus,
	LuSearch,
	LuTerminal,
} from "react-icons/lu";
import { VscGithubAlt, VscLayout, VscNewFolder } from "react-icons/vsc";
import logo from "renderer/assets/jedv-logo.svg";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { Project } from "../../types";
import type { ProjectActionKind } from "../JedvProjectActions";
export function JedvEmptyState({
	workspace,
	gitEnabled,
	projects,
	disabled,
	onProjectAction,
	onNewWorkspace,
	onConnect,
	onOpenProject,
	onTerminal,
	onFiles,
	onChanges,
	onSearchFiles,
}: {
	workspace: boolean;
	gitEnabled: boolean;
	projects: Project[];
	disabled: boolean;
	onProjectAction(kind: ProjectActionKind): void;
	onNewWorkspace(): void;
	onConnect(): void;
	onOpenProject(id: string): void;
	onTerminal(): void;
	onFiles(): void;

	onChanges(): void;
	onSearchFiles(): void;
}) {
	const { t } = useLingui();
	const terminalShortcut = useHotkeyDisplay("NEW_GROUP").text;

	const changesShortcut = useHotkeyDisplay("OPEN_DIFF_VIEWER").text;
	const filesShortcut = useHotkeyDisplay("QUICK_OPEN").text;
	const projectShortcut = useHotkeyDisplay("OPEN_PROJECT").text;
	const workspaceShortcut = useHotkeyDisplay("NEW_WORKSPACE").text;
	const actions = workspace
		? [
				{
					label: t({ message: "New Terminal" }),
					shortcut: terminalShortcut,
					icon: LuTerminal,
					run: onTerminal,
				},

				...(gitEnabled
					? [
							{
								label: t({ message: "Open Changes" }),
								shortcut: changesShortcut,
								icon: LuGitCompareArrows,
								run: onChanges,
							},
						]
					: []),
				{
					label: t({ message: "Search Files" }),
					shortcut: filesShortcut,
					icon: LuSearch,
					run: onSearchFiles,
				},
				{
					label: t({ message: "Files" }),
					shortcut: "",
					icon: LuFolderOpen,
					run: onFiles,
				},
			]
		: [
				{
					label: t({ message: "Open project" }),
					shortcut: projectShortcut,
					icon: LuFolderOpen,
					run: () => onProjectAction("open"),
				},
				{
					label: t({ message: "Clone from URL" }),
					shortcut: "",
					icon: VscGithubAlt,
					run: () => onProjectAction("clone"),
				},
				{
					label: t({ message: "Create new project" }),
					shortcut: "",
					icon: VscNewFolder,
					run: () => onProjectAction("empty"),
				},
				{
					label: t({ message: "Start from a template" }),
					shortcut: "",
					icon: VscLayout,
					run: () => onProjectAction("template"),
				},

				...(projects.length
					? [
							{
								label: t({ message: "New workspace" }),
								shortcut: workspaceShortcut,
								icon: LuPlus,
								run: onNewWorkspace,
							},
						]
					: []),
				{
					label: t({ message: "Connect to host" }),
					shortcut: "",
					icon: LuNetwork,
					run: onConnect,
				},
			];
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
			<div className="w-full max-w-[300px] px-4 py-8">
				<div className="mb-5 flex items-center justify-center gap-2.5">
					<img src={logo} alt="" className="size-7 select-none opacity-90" />
					<span className="text-xl font-medium tracking-tight text-foreground/90">
						Jedv
					</span>
				</div>
				{!workspace && (
					<h1 className="mb-3.5 text-center text-[13.5px] font-medium text-muted-foreground">
						<Trans>Select a project</Trans>
					</h1>
				)}
				<div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/70 bg-card/40 p-1">
					{actions.map((action) => (
						<Button
							key={action.label}
							type="button"
							variant="ghost"
							disabled={action.run === onConnect ? false : disabled}
							className="group h-9 w-full justify-between rounded-lg px-2.5 text-[13px] font-normal text-foreground/85 hover:bg-accent/60 hover:text-foreground"
							onClick={action.run}
						>
							<span className="flex min-w-0 items-center gap-2.5">
								<action.icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
								<span className="truncate">{action.label}</span>
							</span>
							{action.shortcut && action.shortcut !== "Unassigned" && (
								<Kbd className="shrink-0">{action.shortcut}</Kbd>
							)}
						</Button>
					))}
				</div>
				{!workspace && projects.length > 0 && (
					<div className="mt-5 border-t border-border/60 pt-3.5">
						<h2 className="mb-1.5 px-2 text-[11px] font-medium text-muted-foreground/80">
							<Trans>Recent projects</Trans>
						</h2>
						<div className="space-y-0.5">
							{projects.slice(0, 5).map((project) => (
								<Button
									key={project.id}
									variant="ghost"
									className="h-8 w-full justify-start rounded-md px-2 text-[13px] font-normal text-muted-foreground hover:bg-accent/50 hover:text-foreground"
									disabled={disabled}
									onClick={() => onOpenProject(project.id)}
								>
									<span className="truncate">{project.name}</span>
								</Button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
