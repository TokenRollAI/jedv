import { z } from "zod";

export const DEFAULT_DESKTOP_NOTIFICATIONS_PORT = 52741;

export const desktopNotificationSchema = z.object({
	title: z.string().trim().min(1).max(200),
	body: z.string().max(2000).optional(),
	sound: z.boolean().default(false),
	target: z
		.object({ workspaceId: z.string().min(1), terminalId: z.string().min(1) })
		.optional(),
});

export type DesktopNotification = z.infer<typeof desktopNotificationSchema>;
