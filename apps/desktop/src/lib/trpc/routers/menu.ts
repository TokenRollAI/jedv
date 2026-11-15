import { observable } from "@trpc/server/observable";
import { requireMainWindow } from "main/lib/main-events";
import {
	menuEmitter,
	type OpenSettingsEvent,
	type OpenWorkspaceEvent,
	type SettingsSection,
} from "main/lib/menu-events";
import { getFocusedOrLastWindow } from "main/lib/window-registry/window-registry";
import { publicProcedure, router } from "..";

type MenuEvent =
	| { type: "open-settings"; data: OpenSettingsEvent }
	| { type: "open-workspace"; data: OpenWorkspaceEvent }
	| { type: "open-project" }
	| { type: "toggle-presets-bar" }
	| { type: "check-resources" };

export const createMenuRouter = () => {
	return router({
		subscribe: publicProcedure.subscription(({ ctx }) => {
			const window = requireMainWindow(ctx.senderWindow);
			return observable<MenuEvent>((emit) => {
				const send = (event: MenuEvent) => {
					if (getFocusedOrLastWindow() === window) emit.next(event);
				};
				const onOpenSettings = (section?: SettingsSection) => {
					send({ type: "open-settings", data: { section } });
				};

				const onOpenWorkspace = (workspaceId: string) => {
					send({ type: "open-workspace", data: { workspaceId } });
				};

				const onOpenProject = () => {
					send({ type: "open-project" });
				};

				const onTogglePresetsBar = () => {
					send({ type: "toggle-presets-bar" });
				};

				const onCheckResources = () => {
					send({ type: "check-resources" });
				};

				menuEmitter.on("open-settings", onOpenSettings);
				menuEmitter.on("open-workspace", onOpenWorkspace);
				menuEmitter.on("open-project", onOpenProject);
				menuEmitter.on("toggle-presets-bar", onTogglePresetsBar);
				menuEmitter.on("check-resources", onCheckResources);

				const cleanup = () => {
					menuEmitter.off("open-settings", onOpenSettings);
					menuEmitter.off("open-workspace", onOpenWorkspace);
					menuEmitter.off("open-project", onOpenProject);
					menuEmitter.off("toggle-presets-bar", onTogglePresetsBar);
					menuEmitter.off("check-resources", onCheckResources);
				};
				const closed = () => {
					cleanup();
					emit.complete();
				};
				window.once("closed", closed);
				return () => {
					cleanup();
					window.removeListener("closed", closed);
				};
			});
		}),
	});
};
