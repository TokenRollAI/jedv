import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import { app, BrowserWindow, Menu } from "electron";
import { safeOpenExternal } from "main/lib/safe-url";
import { JEDV_REPOSITORY_URL } from "shared/jedv";
import { getAppDisplayName } from "./app-display-name";
import { checkForUpdatesInteractive, openReleaseNotes } from "./auto-updater";
import { menuEmitter } from "./menu-events";
import { confirmAndQuitCompletely } from "./quit-completely";

export function createApplicationMenu() {
	const displayName = getAppDisplayName();
	const reloadAccelerator = "CmdOrCtrl+R";
	const closeAccelerator = "CmdOrCtrl+Shift+Q";
	const openSettingsAccelerator = "CmdOrCtrl+,";
	// macOS/VS Code convention for New Window. On Windows/Linux Ctrl+Shift+N is
	// already New Workspace, so use Ctrl+Alt+N there.
	const newWindowAccelerator =
		process.platform === "darwin" ? "Cmd+Shift+N" : "Ctrl+Alt+N";

	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: i18n._(msg({ message: "File" })),
			submenu: [
				{
					label: i18n._(
						msg({
							message: "New Window",
						}),
					),
					accelerator: newWindowAccelerator,
					click: () => {
						menuEmitter.emit("new-window");
					},
				},
				{ type: "separator" },
				// No accelerator: on macOS it is always live and would bypass the
				// user's OPEN_PROJECT / OPEN_IN_APP bindings (Settings > Keyboard).
				{
					label: i18n._(
						msg({
							message: "Add Project from Folder...",
						}),
					),
					click: () => {
						menuEmitter.emit("open-project");
					},
				},
				{ type: "separator" },
				// Explicit click handler (not `role: "close"`) — `role: "close"` adds
				// an implicit CmdOrCtrl+W accelerator that overrides browser-manager's
				// `before-input-event` interception and closes the window instead of
				// the focused pane.
				{
					label: i18n._(
						msg({
							message: "Close Window",
						}),
					),
					click: () => {
						BrowserWindow.getFocusedWindow()?.close();
					},
				},
				// macOS keeps these in the application menu, which only it has.
				...(process.platform === "darwin"
					? []
					: ([
							{ type: "separator" },
							{
								label: i18n._(msg({ message: "Check for Updates..." })),
								click: () => {
									void checkForUpdatesInteractive();
								},
							},
							{
								label: i18n._(msg({ message: "Release Notes" })),
								click: () => {
									void openReleaseNotes();
								},
							},
							{ role: "about" },
							{
								label: i18n._(msg({ message: "Settings..." })),
								accelerator: openSettingsAccelerator,
								click: () => {
									menuEmitter.emit("open-settings");
								},
							},
							{ type: "separator" },
							{ role: "quit" },
							{
								label: i18n._(
									msg({ message: `Quit ${displayName} Completely` }),
								),
								click: () => {
									void confirmAndQuitCompletely();
								},
							},
						] satisfies Electron.MenuItemConstructorOptions[])),
			],
		},
		{
			label: i18n._(msg({ message: "Edit" })),
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: i18n._(msg({ message: "View", context: "menu" })),
			submenu: [
				{
					label: i18n._(msg({ message: "Reload" })),
					accelerator: reloadAccelerator,
					click: () => {
						BrowserWindow.getFocusedWindow()?.reload();
					},
				},
				// Explicit click handler (not `role: "forceReload"`) — the role adds
				// an implicit CmdOrCtrl+Shift+R accelerator that prevents the renderer's
				// Reopen Closed Tab shortcut from receiving the event.
				{
					label: i18n._(
						msg({
							message: "Force Reload",
						}),
					),
					click: () => {
						BrowserWindow.getFocusedWindow()?.webContents.reloadIgnoringCache();
					},
				},
				{ role: "toggleDevTools" },
				{ type: "separator" },
				// Display-only accelerators: the renderer owns ZOOM_IN/ZOOM_OUT/
				// ZOOM_RESET so a focused terminal zooms its font and a focused
				// browser pane zooms its page. Registering them here would fire
				// the role (page zoom) before the renderer ever sees the key.
				{ role: "resetZoom", registerAccelerator: false },
				{ role: "zoomIn", registerAccelerator: false },
				{ role: "zoomOut", registerAccelerator: false },
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Toggle Scripts Bar",
						}),
					),
					click: () => {
						menuEmitter.emit("toggle-presets-bar");
					},
				},
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: i18n._(msg({ message: "Window" })),
			// macOS appends the list of open windows to a windowMenu-role menu,
			// which is how you switch between platform windows. Without the role
			// the list never appears, so multi-window has no switcher.
			role: process.platform === "darwin" ? "windowMenu" : undefined,
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				{ type: "separator" },
				{ role: "close", accelerator: closeAccelerator },
			],
		},
		{
			label: i18n._(msg({ message: "Resources" })),
			submenu: [
				// No accelerator here: on macOS, a menu accelerator is always live
				// and would bypass the renderer's user-customizable CHECK_RESOURCES
				// binding (Settings > Keyboard). The default shortcut stays
				// discoverable via the command palette and keyboard settings, both
				// of which reflect the user's actual current/overridden binding.
				{
					label: i18n._(
						msg({
							message: "Check Resources",
						}),
					),
					click: () => {
						menuEmitter.emit("check-resources");
					},
				},
			],
		},
		{
			label: i18n._(msg({ message: "Help" })),
			submenu: [
				{
					label: i18n._(
						msg({
							message: "Documentation",
						}),
					),
					click: () => {
						void safeOpenExternal(`${JEDV_REPOSITORY_URL}#readme`);
					},
				},
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Source Code",
						}),
					),
					click: () => {
						void safeOpenExternal(JEDV_REPOSITORY_URL);
					},
				},
				{
					label: i18n._(
						msg({
							message: "Report Issue",
						}),
					),
					click: () => {
						void safeOpenExternal(`${JEDV_REPOSITORY_URL}/issues/new`);
					},
				},
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Keyboard Shortcuts",
						}),
					),
					click: () => {
						menuEmitter.emit("open-settings", "keyboard");
					},
				},
			],
		},
	];

	if (process.platform === "darwin") {
		// Electron's built-in role labels are English and use app.name.
		const renamed = displayName !== app.name;
		template.unshift({
			label: displayName,
			submenu: [
				{
					role: "about",
					...(renamed && {
						label: i18n._(msg({ message: `About ${displayName}` })),
					}),
				},
				{
					label: i18n._(msg({ message: "Check for Updates..." })),
					click: () => {
						void checkForUpdatesInteractive();
					},
				},
				{
					label: i18n._(msg({ message: "Release Notes" })),
					click: () => {
						void openReleaseNotes();
					},
				},
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Settings...",
						}),
					),
					accelerator: openSettingsAccelerator,
					click: () => {
						menuEmitter.emit("open-settings");
					},
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{
					role: "hide",
					...(renamed && {
						label: i18n._(msg({ message: `Hide ${displayName}` })),
					}),
				},
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{
					role: "quit",
					...(renamed && {
						label: i18n._(msg({ message: `Quit ${displayName}` })),
					}),
				},
				{
					label: i18n._(
						msg({
							message: `Quit ${displayName} Completely`,
						}),
					),
					click: () => {
						void confirmAndQuitCompletely();
					},
				},
			],
		});
	}

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}
