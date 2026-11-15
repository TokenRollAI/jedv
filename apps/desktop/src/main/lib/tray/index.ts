import { existsSync } from "node:fs";
import { join } from "node:path";
import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import {
	app,
	Menu,
	type MenuItemConstructorOptions,
	nativeImage,
	Tray,
} from "electron";
import { focusMainWindow, quitApp } from "main/index";
import { getAppDisplayName } from "main/lib/app-display-name";
import {
	checkForUpdatesInteractive,
	openReleaseNotes,
} from "main/lib/auto-updater";
import {
	getHostServiceCoordinator,
	type HostServiceStatus,
	type HostServiceStatusEvent,
} from "main/lib/host-service-coordinator";
import { menuEmitter } from "main/lib/menu-events";
import { confirmAndQuitCompletely } from "main/lib/quit-completely";
import { agentIslandManager } from "main/windows/agent-island";

/** Must have "Template" suffix for macOS dark/light mode support */
const TRAY_ICON_FILENAME = "iconTemplate.png";

function getTrayIconPath(): string | null {
	if (app.isPackaged) {
		const prodPath = join(
			process.resourcesPath,
			"app.asar.unpacked/resources/tray",
			TRAY_ICON_FILENAME,
		);
		if (existsSync(prodPath)) return prodPath;
		return null;
	}

	const previewPath = join(__dirname, "../resources/tray", TRAY_ICON_FILENAME);
	if (existsSync(previewPath)) {
		return previewPath;
	}

	const devPath = join(
		app.getAppPath(),
		"src/resources/tray",
		TRAY_ICON_FILENAME,
	);
	if (existsSync(devPath)) {
		return devPath;
	}

	console.warn("[Tray] Icon not found at:", previewPath, "or", devPath);
	return null;
}

let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let statusManager: ReturnType<typeof getHostServiceCoordinator> | null = null;
const updateHostStatus = (_event: HostServiceStatusEvent) => {
	void updateTrayMenu();
};
const updateActivity = () => {
	void updateTrayMenu();
};

function createTrayIcon(): Electron.NativeImage | null {
	const iconPath = getTrayIconPath();
	if (!iconPath) {
		console.warn("[Tray] Icon not found");
		return null;
	}

	try {
		let image = nativeImage.createFromPath(iconPath);
		const size = image.getSize();

		if (image.isEmpty() || size.width === 0 || size.height === 0) {
			console.warn("[Tray] Icon loaded with zero size from:", iconPath);
			return null;
		}

		// 16x16 is standard menu bar size, auto-scales for Retina
		if (size.width > 22 || size.height > 22) {
			image = image.resize({ width: 16, height: 16 });
		}
		image.setTemplateImage(true);
		return image;
	} catch (error) {
		console.warn("[Tray] Failed to load icon:", error);
		return null;
	}
}

function openSettings(): void {
	focusMainWindow();
	menuEmitter.emit("open-settings");
}

/** Host-service run state as the user reads it in the tray, not the wire value. */
function statusLabel(status: HostServiceStatus): string {
	switch (status) {
		case "starting":
			return i18n._(
				msg({
					message: "starting",
				}),
			);
		case "running":
			return i18n._(
				msg({
					message: "running",
				}),
			);
		case "stopped":
			return i18n._(
				msg({
					message: "stopped",
				}),
			);
	}
}

function buildHostServiceSubmenu(
	orgIds: string[],
): MenuItemConstructorOptions[] {
	const coordinator = getHostServiceCoordinator();
	const menuItems: MenuItemConstructorOptions[] = [];

	if (orgIds.length === 0) {
		menuItems.push({
			label: i18n._(
				msg({
					message: "No active services",
				}),
			),
			enabled: false,
		});
		return menuItems;
	}

	let isFirst = true;
	for (const orgId of orgIds) {
		if (!isFirst) {
			menuItems.push({ type: "separator" });
		}
		isFirst = false;

		const status = coordinator.getProcessStatus(orgId);
		const isRunning = status === "running";
		menuItems.push({
			label: i18n._(msg({ message: "This device" })),
			enabled: false,
		});
		menuItems.push({
			label: `  ${statusLabel(status)}`,
			enabled: false,
		});
		menuItems.push({
			// Enabled in "stopped" too — that's the state where users most need
			// restart to work (host-service crashed or never came up). Disabled
			// only while a start is in flight, to avoid racing the pending start.
			label: `  ${i18n._(msg({ message: "Restart" }))}`,
			enabled: status !== "starting",
			click: () => {
				void (async () => {
					try {
						await coordinator.restart(orgId, {
							mode: "local",
						});
					} catch (error) {
						console.error(
							`[Tray] Failed to restart host-service for ${orgId}:`,
							error,
						);
					}
					void updateTrayMenu();
				})();
			},
		});
		menuItems.push({
			label: `  ${i18n._(msg({ message: "Stop" }))}`,
			enabled: isRunning,
			click: () => {
				coordinator.stop(orgId);
				void updateTrayMenu();
			},
		});
	}

	return menuItems;
}

async function updateTrayMenu(): Promise<void> {
	if (!tray) return;

	const coordinator = getHostServiceCoordinator();
	const orgIds = coordinator.getActiveOrganizationIds();

	if (!tray) return;

	const hasActive = orgIds.length > 0;
	const hostServiceLabel = hasActive
		? i18n._({
				...msg({
					message: "Host Service ({count})",
				}),
				values: { count: orgIds.length },
			})
		: i18n._(msg({ message: "Host Service" }));

	const hostServiceSubmenu = buildHostServiceSubmenu(orgIds);

	const displayName = getAppDisplayName();
	const activity = agentIslandManager.activity();
	const counts = [
		i18n._({
			...msg({ message: "{running} working" }),
			values: { running: activity.running },
		}),
		i18n._({
			...msg({ message: "{approvals} approvals" }),
			values: { approvals: activity.approvals },
		}),
	].join(" · ");
	const menu = Menu.buildFromTemplate([
		...(activity.enabled
			? [
					{
						label: `${i18n._(msg({ message: "Agent sessions" }))} · ${counts}`,
						enabled: activity.available,
						click: () => {
							if (tray) agentIslandManager.toggleFromTray(tray.getBounds());
						},
					} satisfies MenuItemConstructorOptions,
					{ type: "separator" as const },
				]
			: []),
		{
			label: hostServiceLabel,
			submenu: hostServiceSubmenu,
		},
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
		{
			label: i18n._(msg({ message: `Open ${displayName}` })),
			click: focusMainWindow,
		},
		{
			label: i18n._(msg({ message: "Settings" })),
			click: openSettings,
		},
		{ type: "separator" },
		{
			label: i18n._(msg({ message: `Close ${displayName}` })),
			click: () => quitApp(),
		},
		{ type: "separator" },
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
	]);

	trayMenu = menu;
	tray.setToolTip(
		activity.enabled && activity.available
			? `${displayName}\n${counts}`
			: displayName,
	);
	tray.setTitle(
		activity.enabled && activity.available
			? activity.approvals
				? ` !${activity.approvals}`
				: activity.running
					? ` ${activity.running}`
					: ""
			: "",
	);
	tray.setContextMenu(activity.available ? null : menu);
}

/** Rebuild the tray menu in place (e.g. after the display language changes). */
export function refreshTrayMenu(): void {
	if (!tray) return;
	void updateTrayMenu();
}

/** Call once after app.whenReady() */
export function initTray(): void {
	if (tray) {
		console.warn("[Tray] Already initialized");
		return;
	}

	if (process.platform !== "darwin") {
		return;
	}

	try {
		const icon = createTrayIcon();
		if (!icon) {
			console.warn("[Tray] Skipping initialization - no icon available");
			return;
		}

		tray = new Tray(icon);
		tray.setToolTip(getAppDisplayName());

		void updateTrayMenu();

		statusManager = getHostServiceCoordinator();
		statusManager.on("status-changed", updateHostStatus);
		agentIslandManager.on("changed", updateActivity);
		tray.on("click", (_event, bounds) => {
			if (agentIslandManager.activity().available)
				agentIslandManager.toggleFromTray(bounds);
		});
		tray.on("right-click", () => {
			if (!tray || !agentIslandManager.activity().available) return;
			agentIslandManager.hide();
			if (trayMenu) tray.popUpContextMenu(trayMenu);
		});

		tray.on("mouse-enter", () => {
			void updateTrayMenu();
		});

		console.log("[Tray] Initialized successfully");
	} catch (error) {
		console.error("[Tray] Failed to initialize:", error);
	}
}

/** Call on app quit */
export function disposeTray(): void {
	statusManager?.removeListener("status-changed", updateHostStatus);
	statusManager = null;
	agentIslandManager.removeListener("changed", updateActivity);
	trayMenu = null;
	if (tray) {
		tray.destroy();
		tray = null;
	}
}
