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
			<div className="w-full max-w-md px-6 py-10">
				<div className="mb-7 flex items-center justify-center gap-2 py-3">
					<img src={logo} alt="" className="size-8 select-none opacity-85" />
					<span className="text-2xl font-medium tracking-tight text-foreground/85">
						Jedv
					</span>
				</div>
				{!workspace && (
					<h1 className="mb-5 text-center text-base font-medium">
						<Trans>Select a project</Trans>
					</h1>
				)}
				<div className="space-y-1">
					{actions.map((action) => (
						<Button
							key={action.label}
							type="button"
							variant="ghost"
							disabled={action.run === onConnect ? false : disabled}
							className="group h-9 w-full justify-between rounded-[6px] px-3 text-sm text-muted-foreground/80 hover:bg-tertiary/60 hover:text-foreground"
							onClick={action.run}
						>
							<span className="flex items-center gap-2">
								<span className="rounded p-1 text-muted-foreground/90">
									<action.icon className="size-4" />
								</span>
								<span>{action.label}</span>
							</span>
							{action.shortcut && action.shortcut !== "Unassigned" && (
								<Kbd>{action.shortcut}</Kbd>
							)}
						</Button>
					))}
				</div>
				{!workspace && projects.length > 0 && (
					<div className="mt-7 border-t border-border pt-4">
						<h2 className="mb-2 px-3 text-xs text-muted-foreground">
							<Trans>Recent projects</Trans>
						</h2>
						{projects.slice(0, 5).map((project) => (
							<Button
								key={project.id}
								variant="ghost"
								className="h-8 w-full justify-start text-sm text-muted-foreground hover:bg-tertiary/60"
								disabled={disabled}
								onClick={() => onOpenProject(project.id)}
							>
								{project.name}
							</Button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
