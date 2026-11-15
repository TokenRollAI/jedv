import type { Server } from "node:http";
import type { Express } from "express";

export function listenForNotifications(
	app: Pick<Express, "listen">,
	port: number,
	logger: Pick<Console, "log" | "error"> = console,
): Server {
	const server = app.listen(port, "127.0.0.1", (error?: Error) => {
		if (error) {
			logger.error("[notifications] Failed to listen:", error);
			return;
		}
		const address = server.address();
		if (address && typeof address !== "string")
			logger.log(
				`[notifications] Listening on http://127.0.0.1:${address.port}`,
			);
	});
	return server;
}
