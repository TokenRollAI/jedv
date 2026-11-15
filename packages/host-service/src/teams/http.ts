import {
	mailDeliverySchema,
	mailInboxSchema,
	mailSendSchema,
	mailWatchSchema,
	teamArchiveSchema,
	teamInitSchema,
	teamRenameSchema,
	teamSelectorSchema,
	teamSpawnSchema,
	teamStartSchema,
	teamStopSchema,
} from "@jedv/shared/teamwork";
import { TRPCError } from "@trpc/server";
import type { Hono } from "hono";
import { ZodError, z } from "zod";
import { httpFailure } from "../http/errors";
import { createOpenApiPaths } from "../http/openapi";
import { isNarrowIngest } from "../peers/ingest-http";
import type { HostServiceContext } from "../types";
import { requireTeamwork } from "./runtime";

export function registerTeamworkHttp(options: {
	app: Hono;
	context: HostServiceContext;
	authenticate: (request: Request) => boolean | Promise<boolean>;
}) {
	const { app, context } = options;
	app.use("/api/v1/*", async (c, next) => {
		if (isNarrowIngest(c.req.raw)) return next();
		if (!(await options.authenticate(c.req.raw)))
			return c.json({ error: "Unauthorized" }, 401);
		return next();
	});
	const definitions = [
		[
			"post",
			"/api/v1/teams/start",
			teamStartSchema,
			async (input: z.infer<typeof teamStartSchema>) =>
				(await requireTeamwork(context)).team.start(input),
		],
		[
			"post",
			"/api/v1/teams/init",
			teamInitSchema,
			async (input: z.infer<typeof teamInitSchema>) =>
				(await requireTeamwork(context)).team.init(input),
		],
		[
			"post",
			"/api/v1/teams/spawn",
			teamSpawnSchema,
			async (input: z.infer<typeof teamSpawnSchema>) =>
				(await requireTeamwork(context)).team.spawn(input),
		],
		[
			"get",
			"/api/v1/teams/status",
			teamSelectorSchema,
			async (input: z.infer<typeof teamSelectorSchema>) =>
				(await requireTeamwork(context)).team.status(input),
		],
		[
			"get",
			"/api/v1/teams",
			z.object({ status: z.enum(["active", "all"]).default("active") }),
			async (input: { status: "active" | "all" }) =>
				(await requireTeamwork(context)).team.list(input.status),
		],
		[
			"post",
			"/api/v1/teams/rename",
			teamRenameSchema,
			async (input: z.infer<typeof teamRenameSchema>) =>
				(await requireTeamwork(context)).team.rename(input),
		],
		[
			"post",
			"/api/v1/teams/pause",
			teamSelectorSchema,
			async (input: z.infer<typeof teamSelectorSchema>) =>
				(await requireTeamwork(context)).team.setPaused(input, true),
		],
		[
			"post",
			"/api/v1/teams/resume",
			teamSelectorSchema,
			async (input: z.infer<typeof teamSelectorSchema>) =>
				(await requireTeamwork(context)).team.setPaused(input, false),
		],
		[
			"post",
			"/api/v1/teams/stop",
			teamStopSchema,
			async (input: z.infer<typeof teamStopSchema>) =>
				(await requireTeamwork(context)).team.stop(input),
		],
		[
			"post",
			"/api/v1/teams/archive",
			teamArchiveSchema,
			async (input: z.infer<typeof teamArchiveSchema>) =>
				(await requireTeamwork(context)).team.archive(input),
		],
		[
			"post",
			"/api/v1/mail",
			mailSendSchema,
			async (input: z.infer<typeof mailSendSchema>) =>
				(await requireTeamwork(context)).mail.send(input),
		],
		[
			"get",
			"/api/v1/mail/inbox",
			mailInboxSchema,
			async (input: z.infer<typeof mailInboxSchema>) =>
				(await requireTeamwork(context)).mail.inbox(input),
		],
		[
			"get",
			"/api/v1/mail/watch",
			mailWatchSchema,
			async (input: z.infer<typeof mailWatchSchema>, signal?: AbortSignal) =>
				(await requireTeamwork(context)).mail.watch(input, signal),
		],
		[
			"get",
			"/api/v1/mail/timeline",
			teamSelectorSchema.extend({
				limit: z.coerce.number().int().min(1).max(500).default(100),
			}),
			async (input: z.infer<typeof teamSelectorSchema> & { limit: number }) =>
				(await requireTeamwork(context)).mail.timeline(input),
		],
		[
			"post",
			"/api/v1/mail/:id/read",
			mailDeliverySchema,
			async (input: z.infer<typeof mailDeliverySchema>) =>
				(await requireTeamwork(context)).mail.consume(input, false),
		],
		[
			"post",
			"/api/v1/mail/:id/ack",
			mailDeliverySchema,
			async (input: z.infer<typeof mailDeliverySchema>) =>
				(await requireTeamwork(context)).mail.consume(input, true),
		],
	] as const;
	for (const [method, path, schema, handler] of definitions) {
		app.on(method.toUpperCase(), path, async (c) => {
			try {
				const query = c.req.query();
				const raw =
					method === "get"
						? query.input
							? JSON.parse(query.input)
							: Object.fromEntries(
									Object.entries(query).map(([key, value]) => [
										key,
										key === "limit" || key === "timeoutMs"
											? Number(value)
											: key === "includeAcked"
												? value === "true"
												: value,
									]),
								)
						: await c.req.json();
				const input = schema.parse({
					...raw,
					...(c.req.param("id") ? { deliveryId: c.req.param("id") } : {}),
				});
				// Every handler is paired with its schema in the closed registry above.
				const result = await (
					handler as (input: unknown, signal: AbortSignal) => Promise<unknown>
				)(input, c.req.raw.signal);
				return c.json(result);
			} catch (error) {
				if (error instanceof ZodError || error instanceof SyntaxError)
					return c.json(
						{ error: "Invalid request", details: error.message },
						400,
					);
				if (error instanceof TRPCError)
					return c.json(
						{ error: error.message, code: error.code },
						httpFailure(error).status,
					);
				console.error("[teamwork:http] request failed", error);
				return c.json({ error: "Teamwork request failed" }, 500);
			}
		});
	}
	const paths = createOpenApiPaths(definitions, "Teamwork service result");
	app.get("/api/v1/openapi.json", (c) =>
		c.json({
			openapi: "3.1.0",
			info: { title: "Jedv local Teamwork", version: "1" },
			security: [{ bearerAuth: [] }],
			components: {
				securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
			},
			paths,
		}),
	);
}
