import type { BrowserWindow, Event as ElectronEvent } from "electron";

export async function closeUpdateWindows(
	windows: BrowserWindow[],
): Promise<boolean> {
	for (const window of windows) {
		if (window.isDestroyed()) continue;
		const contents = window.webContents;
		const allowed = await new Promise<boolean>((resolve) => {
			const finish = (result: boolean) => {
				window.removeListener("closed", closed);
				window.removeListener("close", closing);
				contents.removeListener("will-prevent-unload", blocked);
				resolve(result);
			};
			const closed = () => finish(true);
			const closing = (event: ElectronEvent) => {
				if (event.defaultPrevented) finish(false);
			};
			const blocked = (event: ElectronEvent) => {
				if (!event.defaultPrevented) finish(false);
			};
			window.once("closed", closed);
			window.on("close", closing);
			contents.on("will-prevent-unload", blocked);
			try {
				window.close();
			} catch {
				finish(false);
			}
		});
		if (!allowed) return false;
	}
	return true;
}
