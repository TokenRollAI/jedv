import { expect, test } from "bun:test";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { initTRPC } from "@trpc/server";
import { Hono } from "hono";
import superjson from "superjson";
import { createLocalClient } from "../../../../apps/desktop/src/renderer/components/JedvShell/local-client";

test("desktop cancellation reaches the host without aborting an unrelated batched query", async () => {
	const t = initTRPC.create({ transformer: superjson });
	const started = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	const health = Promise.withResolvers<string>();
	const router = t.router({
		project: t.router({
			create: t.procedure.mutation(({ signal }) => {
				started.resolve();
				return new Promise<void>((resolve) => {
					signal?.addEventListener(
						"abort",
						() => {
							aborted.resolve();
							resolve();
						},
						{ once: true },
					);
				});
			}),
		}),
		health: t.router({ check: t.procedure.query(() => health.promise) }),
	});
	const app = new Hono().use("/trpc/*", trpcServer({ router }));
	const listening = Promise.withResolvers<number>();
	const server = serve(
		{ fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
		(info) => listening.resolve(info.port),
	);
	const controller = new AbortController();
	try {
		const client = createLocalClient({
			port: await listening.promise,
			secret: "fixture",
			machineId: "fixture",
		});
		const check = client.health.check.query();
		const pending = client.project.create
			.mutate(
				{
					name: "fixture",
					mode: { kind: "empty", parentDir: "/fixture" },
				},
				{ signal: controller.signal, context: { skipBatch: true } },
			)
			.catch(() => "aborted");
		await started.promise;
		controller.abort();
		expect(await pending).toBe("aborted");
		await aborted.promise;
		health.resolve("still connected");
		expect(await check).toBe("still connected");
	} finally {
		controller.abort();
		health.resolve("cleanup");
		server.close();
		if ("closeAllConnections" in server) server.closeAllConnections();
	}
});
