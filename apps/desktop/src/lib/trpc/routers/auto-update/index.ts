import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import type { BrowserWindow } from "electron";
import {
	type AutoUpdateStatusEvent,
	autoUpdateEmitter,
	checkForUpdates,
	checkForUpdatesInteractive,
	dismissUpdate,
	getUpdateStatus,
	getUpdateVersionInfo,
	installUpdate,
	openReleaseNotes,
} from "main/lib/auto-updater";
import { getEntry } from "main/lib/window-registry/window-registry";
import { publicProcedure, router } from "../..";

function assertMainWindow(window: BrowserWindow | null): void {
	if (!window || window.isDestroyed() || getEntry(window.id)?.window !== window)
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "A registered main window is required",
		});
}

const mainProcedure = publicProcedure.use(({ ctx, next }) => {
	assertMainWindow(ctx.senderWindow);
	return next();
});

export const createAutoUpdateRouter = () =>
	router({
		subscribe: mainProcedure.subscription(() =>
			observable<AutoUpdateStatusEvent>((emit) => {
				emit.next(getUpdateStatus());
				const changed = (event: AutoUpdateStatusEvent) => emit.next(event);
				autoUpdateEmitter.on("status-changed", changed);
				return () => {
					autoUpdateEmitter.off("status-changed", changed);
				};
			}),
		),
		getStatus: mainProcedure.query(() => getUpdateStatus()),
		getVersionInfo: mainProcedure.query(() => getUpdateVersionInfo()),
		check: mainProcedure.mutation(() => checkForUpdates()),
		checkInteractive: mainProcedure.mutation(() =>
			checkForUpdatesInteractive(),
		),
		install: mainProcedure.mutation(() => installUpdate()),
		dismiss: mainProcedure.mutation(() => dismissUpdate()),
		openReleaseNotes: mainProcedure.mutation(() => openReleaseNotes()),
	});
