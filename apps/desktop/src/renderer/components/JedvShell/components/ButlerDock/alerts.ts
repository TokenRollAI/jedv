import type { WatchdogAlertShape } from "@jedv/shared/memory";
import { z } from "zod";
// Butler's combined inbox currently exposes alerts as unknown; validate the public Watchdog shape.
export const butlerAlertsSchema: z.ZodType<WatchdogAlertShape[]> = z.array(
	z.object({
		id: z.string(),
		dedupeKey: z.string(),
		kind: z.enum(["suspected_stalled", "mail_unacked", "automation_failed"]),
		subject: z.string(),
		body: z.string(),
		teamId: z.string().nullable(),
		createdAt: z.number(),
		readAt: z.number().nullable(),
	}),
);
