import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	setAgentSetupTemplatesDir,
	setupAgentIntegrations,
	writeSharedDisabledAgentIds,
	writeSharedDisabledSkillIds,
} from "@jedv/agent-setup";
import { i18n, initI18nAsync } from "@jedv/i18n";
import { settings } from "@jedv/local-db";
import { msg } from "@lingui/core/macro";
import {
	app,
	dialog,
	Notification,
	autoUpdater as nativeAutoUpdater,
	net,
	protocol,
	session,
} from "electron";
import { makeAppSetup } from "lib/electron-app/factories/app/setup";
import { applyShellEnvToProcess } from "lib/trpc/routers/workspaces/utils/shell-env";
import {
	APP_PARTITION,
	DEFAULT_CONFIRM_ON_QUIT,
	PLATFORM,
	PROTOCOL_SCHEME,
} from "shared/constants";
import { LOCAL_HOST_NAMESPACE } from "shared/jedv";
import { sweepDevAppProfiles } from "./dev-app-profile-sweep";
import { getAppDisplayName } from "./lib/app-display-name";
import { initAppState } from "./lib/app-state";
import { requestAppleEventsAccess } from "./lib/apple-events-permission";
import {
	disposeAutoUpdater,
	isInstallingUpdate,
	setupAutoUpdater,
} from "./lib/auto-updater";
import { closeUpdateWindows } from "./lib/auto-updater/quit-lifecycle";
import { installBundledCliShim } from "./lib/bundled-cli";
import { startDesktopBridge } from "./lib/desktop-bridge";
import { installDevRunnerExit } from "./lib/dev-runner-exit";
import { setWorkspaceDockIcon } from "./lib/dock-icon";
import { getHostServiceCoordinator } from "./lib/host-service-coordinator";
import { resolveAppLocale } from "./lib/language";
import { localDb } from "./lib/local-db";
import { requestLocalNetworkAccess } from "./lib/local-network-permission";
import { acceptDeepLink, acceptOpenPath } from "./lib/main-events";
import { openPathArguments } from "./lib/main-events/core";
import { menuEmitter } from "./lib/menu-events";
import { portForwardManager } from "./lib/port-forward";
import { ensureProjectIconsDir, getProjectIconPath } from "./lib/project-icons";
import {
	runQuitCleanup,
	shouldQuitAfterWindowsClose,
} from "./lib/quit-sequence";
import { startResourceJournal } from "./lib/resource-metrics/resource-journal";
import { stopPtyDaemons } from "./lib/stop-pty-daemons";
import { disposeTray, initTray } from "./lib/tray";
import {
	getAllWindows,
	getFocusedOrLastWindow,
	watchWindows,
} from "./lib/window-registry/window-registry";
import { sweepNetworkLogs } from "./network-logger-sweep";
import { agentIslandManager } from "./windows/agent-island";
import {
	createPlatformWindow,
	initAppServices,
	markAppQuitting,
	persistOpenWindows,
	restoreWindows,
} from "./windows/main";

console.log("[main] Local database ready:", !!localDb);
const IS_DEV = process.env.NODE_ENV === "development";

void applyShellEnvToProcess().catch((error) => {
	console.error("[main] Failed to apply shell environment:", error);
});

const profilePath = path.join(
	app.getPath("appData"),
	IS_DEV ? `Jedv-${process.env.JEDV_WORKSPACE_ID ?? "development"}` : "Jedv",
);
mkdirSync(profilePath, { recursive: true });
app.setPath("userData", profilePath);
app.setPath("sessionData", profilePath);
app.setName("Jedv");

// Dev mode: register with execPath + app script so macOS launches Electron with our entry point
if (process.defaultApp) {
	if (process.argv.length >= 2) {
		app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
			path.resolve(process.argv[1]),
		]);
	}
} else {
	app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

async function processDeepLink(url: string): Promise<void> {
	if (acceptDeepLink(url) && appReady && !getFocusedOrLastWindow())
		focusMainWindow();
}

function findDeepLinkInArgv(argv: string[]): string | undefined {
	return argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
}
async function processOpenPaths(argv: string[]): Promise<void> {
	for (const file of openPathArguments(argv, process.defaultApp === true)) {
		if (await acceptOpenPath(file)) {
			if (appReady && !getFocusedOrLastWindow()) focusMainWindow();
		}
	}
}

export function focusMainWindow(): void {
	const target = getFocusedOrLastWindow();
	if (target) {
		if (target.isMinimized()) {
			target.restore();
		}
		target.show();
		target.focus();
	} else {
		// Triggers window creation via makeAppSetup's activate handler
		app.emit("activate");
	}
}

function registerWithMacOSNotificationCenter() {
	if (!PLATFORM.IS_MAC || !Notification.isSupported()) return;

	const registrationNotification = new Notification({
		title: getAppDisplayName(),
		body: " ",
		silent: true,
	});

	let handled = false;
	const cleanup = () => {
		if (handled) return;
		handled = true;
		registrationNotification.close();
	};

	registrationNotification.on("show", () => {
		cleanup();
		console.log("[notifications] Registered with Notification Center");
	});

	// Fallback timeout in case macOS doesn't fire events
	setTimeout(cleanup, 1000);

	registrationNotification.show();
}

let appReady = false;
app.on("open-url", (event, url) => {
	event.preventDefault();
	void processDeepLink(url);
});
app.on("open-file", (event, file) => {
	event.preventDefault();
	void acceptOpenPath(file).then((accepted) => {
		if (accepted && appReady && !getFocusedOrLastWindow()) focusMainWindow();
	});
});

let isQuitting = false;
let quitRequested = false;
let preparingUpdateInstall = false;
let quitCleanupComplete = false;
let skipQuitConfirmation = false;
// A second quit request while the confirmation is open would open a second
// dialog on top of the first — the overlay close button on Linux makes that
// easy to trigger.
let quitConfirmationOpen = false;
let forceFullCleanup = false;
let holdingQuitForCleanup = false;

export function setSkipQuitConfirmation(): void {
	skipQuitConfirmation = true;
}

export function quitApp(): void {
	setSkipQuitConfirmation();
	app.quit();
}

/** Quit + also stop background services. Tray "Quit Completely". */
export function quitAppCompletely(): void {
	forceFullCleanup = true;
	setSkipQuitConfirmation();
	app.quit();
}

/** Bypasses before-quit. Host-service children self-exit via the parent watchdog. */
export function exitImmediately(): void {
	app.exit(0);
}

function getLanguageSetting(): string | null {
	try {
		const row = localDb.select().from(settings).get();
		return row?.language ?? null;
	} catch {
		return null;
	}
}

function getConfirmOnQuitSetting(): boolean {
	try {
		const row = localDb.select().from(settings).get();
		return row?.confirmOnQuit ?? DEFAULT_CONFIRM_ON_QUIT;
	} catch {
		return DEFAULT_CONFIRM_ON_QUIT;
	}
}

// macOS keeps running without windows (dock and tray reopen it); elsewhere a
// windowless app is an invisible process nothing brings back.
app.on("window-all-closed", () => {
	if (
		!shouldQuitAfterWindowsClose({
			platform: process.platform,
			quitRequested,
			preparingUpdateInstall,
		})
	)
		return;
	// The last window's close already asked; with no window left there is
	// nothing a cancelled confirmation could keep.
	skipQuitConfirmation = true;
	app.quit();
});

export function resumeAfterCancelledQuit(): void {
	if (isQuitting) return;
	quitRequested = false;
	preparingUpdateInstall = false;
	skipQuitConfirmation = false;
	forceFullCleanup = false;
	markAppQuitting(false);
	if (getAllWindows().length === 0) focusMainWindow();
}

export async function prepareWindowsForUpdate(): Promise<boolean> {
	if (isQuitting || preparingUpdateInstall) return false;
	preparingUpdateInstall = true;
	skipQuitConfirmation = true;
	markAppQuitting();
	persistOpenWindows();
	try {
		const allowed = await closeUpdateWindows(getAllWindows());
		if (!allowed) resumeAfterCancelledQuit();
		return allowed;
	} catch (error) {
		console.error("[main] Update window close failed", error);
		resumeAfterCancelledQuit();
		return false;
	} finally {
		preparingUpdateInstall = false;
	}
}

watchWindows((window) => {
	window.webContents.on("will-prevent-unload", (event) => {
		let response = 2;
		try {
			response = dialog.showMessageBoxSync(window, {
				type: "warning",
				buttons: [
					i18n._(msg({ message: "Return to Save" })),
					i18n._(msg({ message: "Discard Changes" })),
					i18n._(msg({ message: "Cancel" })),
				],
				defaultId: 0,
				cancelId: 2,
				title: i18n._(msg({ message: "Unsaved changes" })),
				message: i18n._(msg({ message: "Save your changes before closing?" })),
			});
		} catch (error) {
			console.error("[main] Unsaved changes confirmation failed", error);
		}
		if (response === 1) {
			event.preventDefault();
			return;
		}
		resumeAfterCancelledQuit();
		if (response === 0 && !window.isDestroyed()) {
			window.show();
			window.focus();
		}
	});
});

nativeAutoUpdater.on("before-quit-for-update", () => {
	if (!isInstallingUpdate()) return;
	skipQuitConfirmation = true;
	quitRequested = true;
	markAppQuitting();
});

app.on("before-quit", async (event) => {
	if (preparingUpdateInstall || holdingQuitForCleanup) {
		event.preventDefault();
		return;
	}
	if (isQuitting || quitRequested) return;
	const isDev = process.env.NODE_ENV === "development";
	if (!skipQuitConfirmation && !isDev && getConfirmOnQuitSetting()) {
		event.preventDefault();
		if (quitConfirmationOpen) return;
		quitConfirmationOpen = true;
		try {
			const displayName = getAppDisplayName();
			const { response } = await dialog.showMessageBox({
				type: "question",
				buttons: [
					i18n._(msg({ message: "Quit" })),
					i18n._(msg({ message: "Cancel" })),
				],
				defaultId: 0,
				cancelId: 1,
				title: i18n._(
					msg({
						message: `Quit ${displayName}`,
						context: "quit confirmation dialog title",
					}),
				),
				message: i18n._(msg({ message: "Are you sure you want to quit?" })),
			});
			if (response === 0) {
				skipQuitConfirmation = true;
				app.quit();
			}
		} catch (error) {
			console.error("[main] Quit confirmation dialog failed:", error);
		} finally {
			quitConfirmationOpen = false;
		}
		return;
	}
	quitRequested = true;
	markAppQuitting();
	persistOpenWindows();
});

app.on("will-quit", async (event) => {
	if (quitCleanupComplete) return;
	event.preventDefault();
	if (holdingQuitForCleanup) return;
	holdingQuitForCleanup = true;
	isQuitting = true;
	const isUpdateInstalling = isInstallingUpdate();
	agentIslandManager.dispose();
	disposeAutoUpdater();
	portForwardManager.stopAll();
	await runQuitCleanup({
		forceFullCleanup,
		isUpdateInstalling,
		stopHostServices: () => getHostServiceCoordinator().stopAll(),
		stopPtyDaemons,
		disposeTray,
		forceExit: (code) => app.exit(code),
	});
	quitCleanupComplete = true;
	holdingQuitForCleanup = false;
	if (isUpdateInstalling) app.quit();
});

process.on("uncaughtException", (error) => {
	if (isQuitting) return;
	console.error("[main] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
	if (isQuitting) return;
	console.error("[main] Unhandled rejection:", reason);
});

if (process.env.NODE_ENV === "development") {
	installDevRunnerExit({
		parentPid: process.ppid,
		stdio: [process.stdout, process.stderr],
		subscribeSignal: (signal, handler) => {
			process.on(signal, handler);
		},
		markQuitting: () => {
			isQuitting = true;
		},
		stopHostServices: () => getHostServiceCoordinator().stopAll(),
		exit: (code) => app.exit(code),
	});
}

// Chromium refuses to cache any single entry larger than about an eighth
// of the disk cache, and the default cache is a few hundred MB — too
// small for a video inside a page. 1 GiB lifts the per-entry cap to
// roughly 128 MB.
app.commandLine.appendSwitch("disk-cache-size", String(1024 * 1024 * 1024));

protocol.registerSchemesAsPrivileged([
	{
		scheme: "jedv-icon",
		privileges: {
			standard: true,
			secure: true,
			bypassCSP: true,
			supportFetchAPI: true,
		},
	},
	{
		scheme: "jedv-font",
		privileges: {
			standard: true,
			secure: true,
			bypassCSP: true,
			supportFetchAPI: true,
		},
	},
]);

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.exit(0);
} else {
	// Windows/Linux: protocol URL arrives as argv on the second instance
	app.on("second-instance", async (_event, argv) => {
		// An auto-update restart spawns the replacement while this process
		// still holds the single-instance lock; don't build windows mid-quit.
		if (isQuitting) return;
		await processOpenPaths(argv);
		const url = findDeepLinkInArgv(argv);
		if (url) {
			// processDeepLink focuses the window on every one of its paths.
			await processDeepLink(url);
			return;
		}
		// The desktop entry's "New Window" action (GNOME top-bar/dock app
		// menus) relaunches the executable with --new-window, and the
		// single-instance lock lands it here. A plain relaunch keeps the
		// Electron-standard behavior of focusing the running app, so a
		// Start-menu or launcher re-click never stacks extra windows. The
		// listener-count check covers the boot window before initAppServices
		// registers the handler; falling back to focus matches pre-ready
		// behavior instead of dropping the event silently.
		if (
			argv.includes("--new-window") &&
			menuEmitter.listenerCount("new-window") > 0
		) {
			console.log("[main] Second instance requested a new window");
			menuEmitter.emit("new-window");
			return;
		}
		focusMainWindow();
	});

	(async () => {
		await app.whenReady();
		// Persisted language setting wins; otherwise infer from OS preferences
		// (plans/20260826-i18n-strategy.md). Menus are built later in
		// initAppServices/initTray, so a plain activate is enough here.
		await initI18nAsync(resolveAppLocale(getLanguageSetting()));
		if (getAppDisplayName() !== app.name) {
			app.setAboutPanelOptions({
				applicationName: getAppDisplayName(),
				applicationVersion: app.getVersion(),
				version: app.getVersion(),
			});
		}
		registerWithMacOSNotificationCenter();
		requestAppleEventsAccess();
		requestLocalNetworkAccess();

		// Must register on both default session and the app's custom partition
		const iconProtocolHandler = (request: Request) => {
			const url = new URL(request.url);
			const projectId = url.pathname.replace(/^\//, "");
			const iconPath = getProjectIconPath(projectId);
			if (!iconPath) {
				return new Response("Not found", { status: 404 });
			}
			return net.fetch(pathToFileURL(iconPath).toString());
		};
		protocol.handle("jedv-icon", iconProtocolHandler);
		session
			.fromPartition(APP_PARTITION)
			.protocol.handle("jedv-icon", iconProtocolHandler);

		// Serve system fonts (e.g. SF Mono on macOS) via custom protocol
		// so the renderer can use @font-face with font-src 'self' CSP
		if (process.platform === "darwin") {
			const SYSTEM_FONT_DIRS = [
				"/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts",
				"/System/Library/Fonts",
				"/Library/Fonts",
			];
			const fontProtocolHandler = async (request: Request) => {
				const url = new URL(request.url);
				const filename = path.basename(url.pathname);
				if (!/\.(otf|ttf|woff2?)$/i.test(filename)) {
					return new Response("Not found", { status: 404 });
				}
				for (const dir of SYSTEM_FONT_DIRS) {
					const fontPath = path.join(dir, filename);
					try {
						return await net.fetch(pathToFileURL(fontPath).toString());
					} catch {
						// Not in this directory
					}
				}
				return new Response("Not found", { status: 404 });
			};
			protocol.handle("jedv-font", fontProtocolHandler);
			session
				.fromPartition(APP_PARTITION)
				.protocol.handle("jedv-font", fontProtocolHandler);
		}

		ensureProjectIconsDir();
		setWorkspaceDockIcon();

		await initAppState();
		setupAutoUpdater();
		agentIslandManager.initialize();

		sweepNetworkLogs();
		sweepDevAppProfiles();

		try {
			await startDesktopBridge();
		} catch (error) {
			console.error("[main] Failed to start desktop bridge:", error);
		}
		const hostServiceCoordinator = getHostServiceCoordinator();
		hostServiceCoordinator.setConfigProvider(async () => ({ mode: "local" }));
		void hostServiceCoordinator.reconcile([LOCAL_HOST_NAMESPACE], {
			mode: "local",
		});

		try {
			// Vite places the lifecycle hook templates next to this bundle.
			setAgentSetupTemplatesDir(path.join(__dirname, "templates"));
			const settingsRow = localDb.select().from(settings).get();
			const disabledAgentHooks = settingsRow?.disabledAgentHooks ?? [];
			const disabledSkills = settingsRow?.disabledSkills ?? [];
			// Mirror the disable lists so CLI-launched host-services on this
			// machine honor them instead of re-provisioning disabled agents/skills.
			writeSharedDisabledAgentIds(disabledAgentHooks);
			writeSharedDisabledSkillIds(disabledSkills);
			setupAgentIntegrations({
				disabledAgentIds: disabledAgentHooks,
				disabledSkillIds: disabledSkills,
			});
		} catch (error) {
			console.error("[main] Failed to set up agent integrations:", error);
		}

		try {
			installBundledCliShim();
		} catch (error) {
			console.error("[main] Failed to install bundled CLI shim:", error);
		}

		if (IS_DEV) {
			hostServiceCoordinator.enableDevReload(async () => ({ mode: "local" }));
		}

		initAppServices();
		await makeAppSetup(
			() => createPlatformWindow({ orgId: null }),
			restoreWindows,
		);

		initTray();
		startResourceJournal();

		for (const url of process.argv.filter((arg) =>
			arg.startsWith(`${PROTOCOL_SCHEME}://`),
		))
			await processDeepLink(url);
		await processOpenPaths(process.argv);

		appReady = true;
	})();
}
