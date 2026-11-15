import { TRPCError } from "@trpc/server";
import type { BrowserWindow } from "electron";
import { getEntry } from "../window-registry/window-registry";

export function requireMainWindow(window: BrowserWindow | null): BrowserWindow {
	if (!window || window.isDestroyed() || getEntry(window.id)?.window !== window)
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Registered main window required",
		});
	return window;
}
export function mainWindowKey(window: BrowserWindow | null): string {
	const owner = requireMainWindow(window);
	const entry = getEntry(owner.id);
	if (!entry)
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Registered main window required",
		});
	return entry.key;
}
