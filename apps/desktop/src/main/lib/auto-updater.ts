import { EventEmitter } from "node:events";
import { existsSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import { app, dialog, type MessageBoxOptions, shell } from "electron";
import log from "electron-log/main";
import { autoUpdater } from "electron-updater";
import { env } from "main/env.main";
import { prepareWindowsForUpdate, resumeAfterCancelledQuit } from "main/index";
import { appState } from "main/lib/app-state";
import {
	getAllWindows,
	getFocusedOrLastWindow,
} from "main/lib/window-registry/window-registry";
import {
	AUTO_UPDATE_STATUS,
	type AutoUpdateStatusEvent,
} from "shared/auto-update";
import { JEDV_RELEASES_URL } from "shared/jedv";
import { AutoUpdaterRuntime } from "./auto-updater/runtime";
import { verifyMacAppSignature } from "./auto-updater/signature";

export type { AutoUpdateStatusEvent } from "shared/auto-update";
export const autoUpdateEmitter = new EventEmitter();
let runtime: AutoUpdaterRuntime | undefined;

function showMessage(options: MessageBoxOptions) {
	const window = getFocusedOrLastWindow();
	return window
		? dialog.showMessageBox(window, options)
		: dialog.showMessageBox(options);
}

function getRuntime(): AutoUpdaterRuntime {
	if (runtime) return runtime;
	log.transports.file.level = "info";
	runtime = new AutoUpdaterRuntime({
		updater: autoUpdater,
		version: app.getVersion(),
		platform: process.platform,
		packaged: app.isPackaged,
		development: env.NODE_ENV !== "production",
		metadataExists: () =>
			existsSync(join(process.resourcesPath, "app-update.yml")),
		disabledByEnvironment: () =>
			process.platform === "darwin" &&
			process.env.DISABLE_UPDATE_CHECK !== undefined,
		verifySignature: () =>
			process.platform === "darwin"
				? verifyMacAppSignature(app.getAppPath())
				: Promise.resolve(true),
		freeBytes: () => {
			try {
				const { bavail, bsize } = statfsSync(app.getPath("userData"));
				return bavail * bsize;
			} catch {
				return null;
			}
		},
		lastRunVersion: appState.data.lastRunVersion,
		persistVersion: async (version) => {
			appState.data.lastRunVersion = version;
			await appState.write();
		},
		confirmInstall: async () => {
			const { response } = await showMessage({
				type: "question",
				buttons: [
					i18n._(msg({ message: "Restart to Install" })),
					i18n._(msg({ message: "Cancel" })),
				],
				defaultId: 1,
				cancelId: 1,
				title: i18n._(msg({ message: "Updates" })),
				message: i18n._(msg({ message: "An update is ready to install." })),
				detail: i18n._(
					msg({
						message:
							"Save your work before restarting. Unsaved changes can still prevent the restart.",
					}),
				),
			});
			return response === 0;
		},
		prepareInstall: prepareWindowsForUpdate,
		installFailed: resumeAfterCancelledQuit,
		observeQuitCancellation: (cancel) => {
			const windows = getAllWindows();
			const blocked = (event: Electron.Event) => {
				if (!event.defaultPrevented) cancel();
			};
			for (const window of windows)
				window.webContents.on("will-prevent-unload", blocked);
			return () => {
				for (const window of windows)
					if (!window.isDestroyed())
						window.webContents.removeListener("will-prevent-unload", blocked);
			};
		},
		logger: log,
	});
	runtime.on("status-changed", (state: AutoUpdateStatusEvent) =>
		autoUpdateEmitter.emit("status-changed", state),
	);
	return runtime;
}

export function setupAutoUpdater(): void {
	getRuntime().start();
}
export function disposeAutoUpdater(): void {
	runtime?.dispose();
}
export function getUpdateStatus(): AutoUpdateStatusEvent {
	return getRuntime().getStatus();
}
export function getUpdateVersionInfo() {
	return getRuntime().versionInfo();
}
export function checkForUpdates() {
	return getRuntime().check();
}
export function isInstallingUpdate(): boolean {
	return runtime?.isInstalling() ?? false;
}
export function isUpdateReadyToInstall(): boolean {
	return runtime?.isReady() ?? false;
}
export function installUpdate() {
	return getRuntime().install();
}
export function dismissUpdate(): void {
	getRuntime().dismiss();
}
export async function openReleaseNotes(): Promise<void> {
	await shell.openExternal(JEDV_RELEASES_URL);
}

export async function checkForUpdatesInteractive(): Promise<AutoUpdateStatusEvent> {
	const state = await checkForUpdates();
	const manualUpdate =
		state.availability === "unsigned" &&
		state.checkOutcome === "update-available";
	const message =
		state.availability !== "supported" && state.availability !== "unsigned"
			? state.reason
			: state.status === AUTO_UPDATE_STATUS.ERROR
				? i18n._(
						msg({
							message: "Failed to check for updates. Please try again later.",
						}),
					)
				: manualUpdate
					? i18n._(
							msg({
								message: "Updates require manual installation for this build.",
							}),
						)
					: state.status === AUTO_UPDATE_STATUS.READY
						? i18n._(msg({ message: "An update is ready to install." }))
						: state.checkOutcome === "up-to-date"
							? i18n._(msg({ message: "You're up to date!" }))
							: i18n._(msg({ message: "Downloading update…" }));
	const { response } = await showMessage({
		...(manualUpdate
			? {
					buttons: [
						i18n._(msg({ message: "Download update" })),
						i18n._(msg({ message: "Close" })),
					],
					defaultId: 0,
					cancelId: 1,
				}
			: {}),
		type: state.status === AUTO_UPDATE_STATUS.ERROR ? "error" : "info",
		title: i18n._(msg({ message: "Updates" })),
		message:
			message ?? i18n._(msg({ message: "Unable to check for updates." })),
		detail: state.error ?? state.version ?? state.currentVersion,
	});
	if (manualUpdate && response === 0) await openReleaseNotes();
	return state;
}
