import { timingSafeEqual } from "node:crypto";
import type { DesktopNotification } from "@jedv/shared/desktop-notification";
import { desktopNotificationSchema } from "@jedv/shared/desktop-notification";
import {
	type PaneLayoutOpResult,
	type PaneLayoutRequest,
	paneLayoutRequestSchema,
} from "@jedv/shared/pane-layout-ops";
import express from "express";
import { z } from "zod";

export function createDesktopBridge(input: {
	secret: string;
	applyLayout(request: PaneLayoutRequest): Promise<PaneLayoutOpResult>;
	showNotification(notification: DesktopNotification): boolean;
}) {
	const app = express();
	app.use((req, res, next) => {
		const candidate = Buffer.from(
			req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "",
		);
		const secret = Buffer.from(input.secret);
		if (
			candidate.length !== secret.length ||
			!timingSafeEqual(candidate, secret)
		) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}
		next();
	});
	app.use(express.json({ limit: "2mb" }));
	app.post("/pane-layout", async (req, res) => {
		const parsed = paneLayoutRequestSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: z.prettifyError(parsed.error) });
			return;
		}
		try {
			res.json(await input.applyLayout(parsed.data));
		} catch (error) {
			const status =
				error instanceof Error &&
				"status" in error &&
				typeof error.status === "number"
					? error.status
					: 500;
			res.status(status).json({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
	app.post("/notify", (req, res) => {
		const parsed = desktopNotificationSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: z.prettifyError(parsed.error) });
			return;
		}
		res.json({ shown: input.showNotification(parsed.data) });
	});
	return app;
}
