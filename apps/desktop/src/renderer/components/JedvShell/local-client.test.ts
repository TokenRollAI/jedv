import { expect, test } from "bun:test";
import { createLocalClient } from "./local-client";

test("local project reads use loopback and the host PSK without a cloud user identity", async () => {
	let requestUrl = "";
	let authorization: string | null = null;
	let machineId: string | null = null;
	let userId: string | null = null;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			requestUrl = request.url;
			authorization = request.headers.get("authorization");
			machineId = request.headers.get("x-jedv-client-machine-id");
			userId = request.headers.get("x-jedv-user-id");
			return Response.json([{ result: { data: { json: [] } } }]);
		},
	});
	try {
		const client = createLocalClient({
			port: server.port ?? 0,
			secret: "local-host-psk",
			machineId: "this-machine",
		});
		expect(await client.project.list.query()).toEqual([]);
		expect(new URL(requestUrl).hostname).toBe("127.0.0.1");
		expect(new URL(requestUrl).pathname).toBe("/trpc/project.list");
		expect<string | null>(authorization).toBe("Bearer local-host-psk");
		expect<string | null>(machineId).toBe("this-machine");
		expect(userId).toBeNull();
	} finally {
		await server.stop(true);
	}
});
