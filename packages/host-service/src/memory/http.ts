import {
	memoryListSchema,
	memoryPutSchema,
	memoryScopeSchema,
	memorySearchSchema,
} from "@jedv/shared/memory";
import { TRPCError } from "@trpc/server";
import type { Hono } from "hono";
import { ZodError, type z } from "zod";
import { httpFailure } from "../http/errors";
import { createOpenApiPaths } from "../http/openapi";
import type { MemoryService } from "./service";
export function registerMemoryHttp(options: {
	app: Hono;
	memory: MemoryService;
	authenticate: (request: Request) => boolean | Promise<boolean>;
}) {
	const { app, memory } = options;
	app.use("/api/v1/memory", async (c, next) => {
		if (!(await options.authenticate(c.req.raw)))
			return c.json({ error: "Unauthorized" }, 401);
		return next();
	});
	app.use("/api/v1/memory/*", async (c, next) => {
		if (!(await options.authenticate(c.req.raw)))
			return c.json({ error: "Unauthorized" }, 401);
		return next();
	});
	const definitions = [
		[
			"get",
			"/api/v1/memory",
			memoryListSchema,
			(input: z.infer<typeof memoryListSchema>) => memory.list(input),
		],
		[
			"get",
			"/api/v1/memory/search",
			memorySearchSchema,
			(input: z.infer<typeof memorySearchSchema>) => memory.search(input),
		],
		[
			"post",
			"/api/v1/memory",
			memoryPutSchema,
			(input: z.infer<typeof memoryPutSchema>) => memory.put(input),
		],
		[
			"get",
			"/api/v1/memory/export",
			memoryScopeSchema,
			(input: z.infer<typeof memoryScopeSchema>) => memory.exportData(input),
		],
	] as const;
	for (const [method, path, schema, handler] of definitions)
		app.on(method.toUpperCase(), path, async (c) => {
			try {
				const query = c.req.query();
				const raw =
					method === "post"
						? await c.req.json()
						: query.input
							? JSON.parse(query.input)
							: {
									...query,
									...(query.limit ? { limit: Number(query.limit) } : {}),
									...(query.includeCandidates
										? { includeCandidates: query.includeCandidates === "true" }
										: {}),
									...(query.includeHistory
										? { includeHistory: query.includeHistory === "true" }
										: {}),
								};
				const input = schema.parse(raw);
				return c.json(await (handler as (input: unknown) => unknown)(input));
			} catch (error) {
				if (error instanceof ZodError || error instanceof SyntaxError)
					return c.json({ error: "Invalid memory request" }, 400);
				if (error instanceof TRPCError)
					return c.json({ error: error.message }, httpFailure(error).status);
				return c.json({ error: "Memory request failed" }, 500);
			}
		});
	const paths = createOpenApiPaths(definitions, "Memory result");
	return { paths };
}
