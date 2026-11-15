import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { closeUpdateWindows } from "./quit-lifecycle";

test("native beforeunload cancellation leaves the blocked window open and stops update preparation", async () => {
	let allowDiscard = false;
	let closes = 0;
	const contents = new EventEmitter();
	contents.on("will-prevent-unload", (event: { defaultPrevented: boolean }) => {
		if (allowDiscard) event.defaultPrevented = true;
	});
	const window = Object.assign(new EventEmitter(), {
		webContents: contents,
		isDestroyed: () => false,
		close() {
			const event = { defaultPrevented: false };
			contents.emit("will-prevent-unload", event);
			if (event.defaultPrevented) {
				closes++;
				window.emit("closed");
			}
		},
	});
	expect(await closeUpdateWindows([window as unknown as BrowserWindow])).toBe(
		false,
	);
	expect(closes).toBe(0);
	expect(contents.listenerCount("will-prevent-unload")).toBe(1);
	allowDiscard = true;
	expect(await closeUpdateWindows([window as unknown as BrowserWindow])).toBe(
		true,
	);
	expect(closes).toBe(1);
	expect(contents.listenerCount("will-prevent-unload")).toBe(1);
});
