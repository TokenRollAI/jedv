import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import log from "electron-log";
import { showCliNotification } from "../notifications/show-cli-notification";
import { paneLayoutRequests } from "../pane-layout/pane-layout-requests";
import { setDesktopBridgeInfo } from "./info";
import { createDesktopBridge } from "./server";

let server: Server | null = null;
export async function startDesktopBridge(): Promise<void> {
	if (server) return;
	const secret = randomBytes(32).toString("hex");
	const app = createDesktopBridge({
		secret,
		applyLayout: ({ workspaceId, op }) =>
			paneLayoutRequests.request(workspaceId, op),
		showNotification: showCliNotification,
	});
	const running = await new Promise<Server>((resolve, reject) => {
		const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
		listener.once("error", reject);
	});
	const address = running.address();
	if (!address || typeof address === "string") {
		running.close();
		throw new Error("Desktop bridge failed to bind a port");
	}
	server = running;
	const endpoint = `http://127.0.0.1:${address.port}`;
	setDesktopBridgeInfo({ endpoint, secret });
	log.info(`[desktop-bridge] listening on ${endpoint}`);
}
export async function stopDesktopBridge(): Promise<void> {
	const running = server;
	server = null;
	setDesktopBridgeInfo(null);
	if (!running) return;
	running.closeAllConnections();
	await new Promise<void>((resolve) => running.close(() => resolve()));
}
