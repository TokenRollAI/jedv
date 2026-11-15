import type { DesktopNotification } from "@jedv/shared/desktop-notification";
import { Notification } from "electron";
import { enqueueMainNavigation, localHostOrigin } from "../main-events";
import { playNotificationSound } from "../notification-sound";
import { getFocusedOrLastWindow } from "../window-registry/window-registry";

/** Shows a notification sent with `jedv notifications show`. */
export function showCliNotification(input: DesktopNotification): boolean {
	if (!Notification.isSupported()) return false;
	const notification = new Notification({
		title: input.title,
		body: input.body ?? "",
		silent: true,
	});
	notification.on("click", () => {
		if (!input.target) {
			const window = getFocusedOrLastWindow();
			if (window?.isMinimized()) window.restore();
			window?.show();
			window?.focus();
			return;
		}
		const hostUrl = localHostOrigin();
		if (hostUrl)
			enqueueMainNavigation("notification", {
				kind: "workspace",
				hostUrl,
				workspaceId: input.target.workspaceId,
				terminalId: input.target.terminalId,
			});
	});
	notification.show();
	if (input.sound) playNotificationSound();
	return true;
}
