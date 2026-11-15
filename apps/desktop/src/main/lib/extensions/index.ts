import { session } from "electron";
import { env } from "main/env.main";
import { APP_PARTITION } from "shared/constants";

export async function loadReactDevToolsExtension(): Promise<void> {
	const extensionPath = process.env.ELECTRON_REACT_DEVTOOLS_PATH;
	if (env.NODE_ENV !== "development" || !extensionPath) return;
	for (const target of [
		session.defaultSession,
		session.fromPartition(APP_PARTITION),
	]) {
		try {
			await target.extensions.loadExtension(extensionPath);
		} catch (error) {
			console.error("[main] Failed to load React DevTools:", error);
		}
	}
}
