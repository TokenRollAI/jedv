import { expect, test } from "bun:test";
import type { Server } from "node:http";
import type { PaneLayoutRequest } from "@jedv/shared/pane-layout-ops";
import { createDesktopBridge } from "./server";

test("desktop bridge keeps authenticated pane and notification calls without browser routes", async () => {
	const applied: PaneLayoutRequest[] = [];
	const shown: string[] = [];
	const app = createDesktopBridge({
		secret: "fixture-secret",
		applyLayout: async (request) => {
			applied.push(request);
			return {
				paneId: null,
				tabId: null,
				layout: { activeTabId: null, tabs: [] },
			};
		},
		showNotification: ({ title }) => {
			shown.push(title);
			return true;
		},
	});
	const server = await new Promise<Server>((resolve) => {
		const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
	});
	try {
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No test port");
		const url = `http://127.0.0.1:${address.port}`;
		const headers = {
			authorization: "Bearer fixture-secret",
			"content-type": "application/json",
		};
		expect((await fetch(`${url}/notify`, { method: "POST" })).status).toBe(401);
		expect(shown).toEqual([]);
		const notify = await fetch(`${url}/notify`, {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "Ready" }),
		});
		expect(await notify.json()).toEqual({ shown: true });
		expect(shown).toEqual(["Ready"]);
		const request = { workspaceId: "workspace", op: { type: "list" } } as const;
		const layout = await fetch(`${url}/pane-layout`, {
			method: "POST",
			headers,
			body: JSON.stringify(request),
		});
		expect(layout.status).toBe(200);
		expect(applied).toEqual([request]);
		for (const route of ["/panes", "/extensions", "/import-sources"])
			expect((await fetch(url + route, { headers })).status).toBe(404);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
