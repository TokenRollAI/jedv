import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { Hono } from "hono";
import { z } from "zod";
import { registerButlerHttp } from "../butler/http";
import { butlerFixture, modelReply } from "../butler/test-fixture";
import { registerMemoryHttp } from "../memory/http";
import { registerTeamworkHttp } from "../teams/http";
import type { HostServiceContext } from "../types";
import {
	createOpenApiPaths,
	mergeOpenApiPaths,
	type OpenApiPaths,
} from "./openapi";

const headers = {
	Authorization: "Bearer isolated-http-contract",
	"Content-Type": "application/json",
};
const authenticate = (request: Request) =>
	request.headers.get("Authorization") === headers.Authorization;

test("real Butler HTTP concurrency exhaustion returns 429 rather than 400", async () => {
	let release = () => {};
	let allEntered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const entered = new Promise<void>((resolve) => {
		allEntered = resolve;
	});
	let calls = 0;
	const f = butlerFixture(async () => {
		if (++calls === 4) allEntered();
		await gate;
		return modelReply("isolated HTTP response");
	});
	const app = new Hono();
	registerButlerHttp({ app, butler: f.service, authenticate });
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: app.fetch,
	});
	const send = (id: string) =>
		fetch(`http://127.0.0.1:${server.port}/api/v1/butler/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				requestId: id,
				newTopic: true,
				humanText: "read isolated status",
			}),
		});
	const pending = Array.from({ length: 4 }, (_, id) => send(`running-${id}`));
	try {
		await entered;
		const rejected = await send("over-capacity");
		expect(rejected.status).toBe(429);
		expect(await rejected.json()).toMatchObject({ code: "TOO_MANY_REQUESTS" });
		expect(calls).toBe(4);
	} finally {
		release();
		for (const result of await Promise.allSettled(pending))
			if (result.status === "fulfilled") await result.value.body?.cancel();
		server.stop(true);
		await f.dispose();
	}
});

test("REST route families preserve service 401/403/429/500 codes over actual HTTP", async () => {
	const f = butlerFixture();
	let code: TRPCError["code"] = "FORBIDDEN";
	const fail = (): never => {
		throw new TRPCError({ code, message: "isolated service rejection" });
	};
	// Instance-local fault injection tests the HTTP boundary without global service mocks.
	f.service.listThreads = fail;
	f.memory.runtime.memory.list = fail;
	const context = {
		runtime: { teamwork: { ready: Promise.resolve(), team: { status: fail } } },
	} as unknown as HostServiceContext;
	const app = new Hono();
	registerButlerHttp({ app, butler: f.service, authenticate });
	registerMemoryHttp({ app, memory: f.memory.runtime.memory, authenticate });
	registerTeamworkHttp({ app, context, authenticate });
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: app.fetch,
	});
	try {
		for (const [next, status] of [
			["UNAUTHORIZED", 401],
			["FORBIDDEN", 403],
			["TOO_MANY_REQUESTS", 429],
			["INTERNAL_SERVER_ERROR", 500],
		] as const) {
			code = next;
			for (const path of [
				"/api/v1/butler/threads",
				"/api/v1/memory?scopeKind=global",
				"/api/v1/teams/status?teamId=isolated",
			]) {
				const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
					headers,
				});
				expect(response.status).toBe(status);
				expect(await response.json()).toMatchObject({
					error: "isolated service rejection",
				});
			}
		}
		const unauthenticated = await fetch(
			`http://127.0.0.1:${server.port}/api/v1/openapi.json`,
		);
		expect(unauthenticated.status).toBe(401);
		await unauthenticated.body?.cancel();
	} finally {
		server.stop(true);
		await f.dispose();
	}
});

type Operation = {
	parameters: Array<{
		name: string;
		in: string;
		required?: boolean;
		schema?: Record<string, unknown>;
		content?: Record<string, { schema: Record<string, unknown> }>;
	}>;
	requestBody?: unknown;
};
test("published GET contracts expose typed direct queries and full nested JSON input", async () => {
	const f = butlerFixture();
	try {
		const app = new Hono();
		const butler = registerButlerHttp({ app, butler: f.service, authenticate });
		const memory = registerMemoryHttp({
			app,
			memory: f.memory.runtime.memory,
			authenticate,
		});
		app.use("/api/v1/openapi.json", async (c, next) => {
			await next();
			const document = (await c.res.json()) as { paths: OpenApiPaths };
			c.res = c.json({
				...document,
				paths: mergeOpenApiPaths(document.paths, memory.paths, butler.paths),
			});
		});
		registerTeamworkHttp({ app, context: f.ctx, authenticate });
		const response = await app.request("/api/v1/openapi.json", { headers });
		expect(response.status).toBe(200);
		const { paths } = (await response.json()) as {
			paths: Record<string, Record<string, Operation>>;
		};
		const threads = paths["/api/v1/butler/threads"]?.get;
		expect(threads?.parameters).toContainEqual({
			in: "query",
			name: "includeAudit",
			required: false,
			schema: { type: "boolean", default: false },
		});
		expect(
			threads?.parameters.find((p) => p.name === "limit")?.schema,
		).toMatchObject({ type: "integer", minimum: 1, maximum: 100, default: 50 });
		expect(
			paths["/api/v1/memory"]?.get?.parameters.find(
				(p) => p.name === "scopeKind",
			)?.schema,
		).toMatchObject({ type: "string", enum: ["global", "project", "team"] });
		const status = paths["/api/v1/teams/status"]?.get;
		const input = status?.parameters.find((p) => p.name === "input");
		expect(input?.content?.["application/json"]?.schema).toMatchObject({
			type: "object",
			properties: {
				actor: {
					type: "object",
					required: ["workspaceId", "terminalId"],
				},
			},
		});
		expect(status?.parameters.some((p) => p.name === "actor")).toBe(false);
		expect(
			paths["/api/v1/mail/watch"]?.get?.parameters.find(
				(p) => p.name === "timeoutMs",
			)?.schema,
		).toMatchObject({ type: "integer", minimum: 0, maximum: 30000 });
		expect(paths["/api/v1/memory"]?.get).toBeDefined();
		expect(paths["/api/v1/memory"]?.post?.requestBody).toBeDefined();
		expect(paths["/api/v1/memory"]?.get?.requestBody).toBeUndefined();
		// Explicitly invalid empty values retain 400 behavior.
		for (const path of [
			"/api/v1/butler/threads?limit=",
			"/api/v1/memory?scopeKind=global&limit=",
			"/api/v1/mail/timeline?limit=",
		])
			expect((await app.request(path, { headers })).status).toBe(400);
	} finally {
		await f.dispose();
	}
});

test("OpenAPI generation and composition retain distinct methods on the same path", () => {
	const schema = z.object({ name: z.string() });
	const generated = createOpenApiPaths(
		[
			["get", "/same", schema],
			["post", "/same", schema],
		],
		"result",
	);
	expect(Object.keys(generated["/same"] ?? {}).sort()).toEqual(["get", "post"]);
	const combined = mergeOpenApiPaths(
		{ "/same": { get: { summary: "existing GET" } } },
		{ "/same": { post: generated["/same"]?.post } },
	);
	expect(combined["/same"]?.get).toEqual({ summary: "existing GET" });
	expect(combined["/same"]?.post).toEqual(generated["/same"]?.post);
});
