import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { createWindowRouter } from "./window";

test("full screen subscriptions follow their sender window and release native listeners", async () => {
	let fullScreen = false;
	let destroyed = false;
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => destroyed,
		isFullScreen: () => fullScreen,
		isMaximized: () => true,
	});
	const caller = createWindowRouter().createCaller({
		senderWindow: window as unknown as BrowserWindow,
	});
	const values: boolean[] = [];
	let completed = false;
	expect(await caller.isFullScreen()).toBe(false);
	const stream = await caller.onFullScreenChange();
	const subscription = stream.subscribe({
		next: (value) => values.push(value),
		complete: () => {
			completed = true;
		},
	});
	fullScreen = true;
	window.emit("enter-full-screen");
	expect(await caller.isFullScreen()).toBe(true);
	fullScreen = false;
	window.emit("leave-full-screen");
	expect(values).toEqual([false, true, false]);
	subscription.unsubscribe();
	expect(window.eventNames()).toEqual([]);
	const afterClose = (await caller.onFullScreenChange()).subscribe({
		complete: () => {
			completed = true;
		},
	});
	destroyed = true;
	window.emit("closed");
	expect(completed).toBe(true);
	expect(window.eventNames()).toEqual([]);
	expect(await caller.isFullScreen()).toBe(false);
	afterClose.unsubscribe();
});
