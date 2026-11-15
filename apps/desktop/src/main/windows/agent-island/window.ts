import { pathToFileURL } from "node:url";
import { BrowserWindow } from "electron";

export function createAgentIslandWindow(options: {
	preloadFile: string;
	htmlFile: string;
	developmentUrl?: string;
	onDismiss: () => void;
}): BrowserWindow {
	const url = new URL(
		options.developmentUrl ?? pathToFileURL(options.htmlFile).href,
	);
	url.searchParams.set("window", "agent-island");
	url.hash = "/";
	const window = new BrowserWindow({
		width: 380,
		height: 280,
		show: false,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		focusable: true,
		alwaysOnTop: false,
		acceptFirstMouse: true,
		webPreferences: {
			preload: options.preloadFile,
			partition: "agent-island",
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webviewTag: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
		},
	});
	window.on("blur", options.onDismiss);
	window.webContents.on("before-input-event", (event, input) => {
		if (input.type === "keyDown" && input.key === "Escape") {
			event.preventDefault();
			options.onDismiss();
		}
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.session.setPermissionRequestHandler(
		(_contents, _permission, callback) => callback(false),
	);
	window.webContents.session.setPermissionCheckHandler(() => false);
	window.webContents.on("will-navigate", (event, target) => {
		const next = new URL(target);
		if (
			next.origin !== url.origin ||
			next.pathname !== url.pathname ||
			next.search !== url.search
		)
			event.preventDefault();
	});
	window.webContents.on("will-frame-navigate", (event) => {
		if (!event.isMainFrame) event.preventDefault();
	});
	window.webContents.on("will-attach-webview", (event) =>
		event.preventDefault(),
	);
	void window.loadURL(url.href).catch((error) => {
		console.error("[agent-island] Failed to load window", error);
		if (!window.isDestroyed()) window.hide();
	});
	return window;
}
