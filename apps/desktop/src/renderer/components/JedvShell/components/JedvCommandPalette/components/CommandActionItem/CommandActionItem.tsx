import { CommandItem, CommandShortcut } from "@jedv/ui/command";
import {
	LuActivity,
	LuFolderGit2,
	LuFolderOpen,
	LuGitCompareArrows,
	LuGitPullRequest,
	LuHistory,
	LuLayoutGrid,
	LuLayoutTemplate,
	LuPlay,
	LuRotateCcw,
	LuSettings,
	LuTerminal,
	LuUndo2,
	LuUsers,
	LuWandSparkles,
} from "react-icons/lu";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { HotkeyId } from "renderer/hotkeys/registry";
import type { JedvCommandAction } from "../../JedvCommandPalette";

const details: Record<string, { icon: typeof LuTerminal; hotkey?: HotkeyId }> =
	{
		"open-in-app": { icon: LuFolderOpen, hotkey: "OPEN_IN_APP" },
		"reopen-tab": { icon: LuRotateCcw, hotkey: "REOPEN_TAB" },
		resources: { icon: LuActivity, hotkey: "CHECK_RESOURCES" },

		"active-workspaces": {
			icon: LuLayoutGrid,
			hotkey: "OPEN_ACTIVE_WORKSPACE_SWITCHER",
		},
		welcome: { icon: LuWandSparkles },
		"run-workspace": { icon: LuPlay, hotkey: "RUN_WORKSPACE_COMMAND" },
		"project-open": { icon: LuFolderOpen, hotkey: "OPEN_PROJECT" },
		"project-folder": { icon: LuFolderOpen },
		"project-clone": { icon: LuFolderGit2 },
		"project-empty": { icon: LuFolderGit2 },
		"project-template": { icon: LuLayoutTemplate },
		terminal: { icon: LuTerminal, hotkey: "NEW_GROUP" },
		settings: { icon: LuSettings, hotkey: "OPEN_SETTINGS" },
		changes: { icon: LuGitCompareArrows, hotkey: "OPEN_DIFF_VIEWER" },
		board: { icon: LuLayoutGrid },
		automations: { icon: LuHistory },
		teamwork: { icon: LuUsers },
		"create-team": { icon: LuUsers },
		pr: { icon: LuGitPullRequest },
		undo: { icon: LuUndo2, hotkey: "UNDO" },
	};
export function CommandActionItem({
	action,
	onChoose,
}: {
	action: JedvCommandAction;
	onChoose(): void;
}) {
	const detail = details[action.id] ?? { icon: LuTerminal };
	const Icon = detail.icon;
	const shortcut = useHotkeyDisplay(
		detail.hotkey ?? "OPEN_COMMAND_PALETTE",
	).text;
	return (
		<CommandItem value={`${action.id} ${action.label}`} onSelect={onChoose}>
			<Icon className="size-4" />
			{action.label}
			{detail.hotkey && shortcut !== "Unassigned" && (
				<CommandShortcut>{shortcut}</CommandShortcut>
			)}
		</CommandItem>
	);
}
