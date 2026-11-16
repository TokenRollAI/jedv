import {
	butlerApprovalListSchema,
	butlerHistorySchema,
	butlerRequestApprovalSchema,
	butlerResolveSchema,
	butlerSendSchema,
	butlerStateQuerySchema,
	butlerThreadListSchema,
} from "@jedv/shared/butler";
import {
	attentionIgnoreSchema,
	attentionQuerySchema,
	attentionSelectorSchema,
} from "@jedv/shared/butler-attention";
import { TRPCError } from "@trpc/server";
import type { Hono } from "hono";
import { ZodError, z } from "zod";
import { httpFailure } from "../http/errors";
import { createOpenApiPaths } from "../http/openapi";
import type { ButlerService } from "./service";
export function registerButlerHttp(options: {
	app: Hono;
	butler: ButlerService;
	authenticate: (request: Request) => boolean | Promise<boolean>;
}) {
	const { app, butler } = options;
	app.use("/api/v1/butler/*", async (c, next) => {
		if (!(await options.authenticate(c.req.raw)))
			return c.json({ error: "Unauthorized" }, 401);
		return next();
	});
	const definitions = [
		[
			"get",
			"/api/v1/butler/capabilities",
			z.object({}),
			() => ({
				protocolVersion: 1,
				features: {
					requestApproval: true,
					attention: true,
					conversationState: true,
					toolProgress: true,
					historyByRequest: true,
				},
			}),
		],
		[
			"get",
			"/api/v1/butler/state",
			butlerStateQuerySchema,
			(x: z.infer<typeof butlerStateQuerySchema>) => butler.state(x),
		],
		[
			"get",
			"/api/v1/butler/attention",
			attentionQuerySchema,
			(x: z.infer<typeof attentionQuerySchema>) => butler.attention(x),
		],
		[
			"post",
			"/api/v1/butler/attention/read",
			attentionSelectorSchema,
			(x: z.infer<typeof attentionSelectorSchema>) =>
				butler.markAttentionRead(x),
		],
		[
			"post",
			"/api/v1/butler/attention/ignore",
			attentionIgnoreSchema,
			(x: z.infer<typeof attentionIgnoreSchema>) => butler.ignoreAttention(x),
		],
		[
			"post",
			"/api/v1/butler/approvals/request",
			butlerRequestApprovalSchema,
			(x: z.infer<typeof butlerRequestApprovalSchema>) =>
				butler.requestApproval(x),
		],
		[
			"post",
			"/api/v1/butler/messages",
			butlerSendSchema,
			(x: z.infer<typeof butlerSendSchema>) => butler.sendMessage(x),
		],
		[
			"get",
			"/api/v1/butler/threads",
			butlerThreadListSchema,
			(x: z.infer<typeof butlerThreadListSchema>) => butler.listThreads(x),
		],
		[
			"get",
			"/api/v1/butler/history",
			butlerHistorySchema,
			(x: z.infer<typeof butlerHistorySchema>) => butler.history(x),
		],
		[
			"get",
			"/api/v1/butler/approvals",
			butlerApprovalListSchema,
			(x: z.infer<typeof butlerApprovalListSchema>) =>
				butler.listApprovalsWithSources(x),
		],
		[
			"post",
			"/api/v1/butler/approvals/:id/resolve",
			butlerResolveSchema,
			(x: z.infer<typeof butlerResolveSchema>) => butler.resolveApproval(x),
		],
		[
			"get",
			"/api/v1/butler/inbox",
			attentionQuerySchema,
			(x: z.infer<typeof attentionQuerySchema>) => butler.inbox(x),
		],
	] as const;
	for (const [method, path, schema, handler] of definitions) {
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
									...(query.before ? { before: Number(query.before) } : {}),
									...(query.includeAudit === "true"
										? { includeAudit: true }
										: query.includeAudit === "false"
											? { includeAudit: false }
											: {}),
								};
				const input = schema.parse({
					...raw,
					...(c.req.param("id") ? { approvalId: c.req.param("id") } : {}),
				});
				return c.json(await (handler as (input: unknown) => unknown)(input));
			} catch (error) {
				if (error instanceof ZodError || error instanceof SyntaxError)
					return c.json({ error: "Invalid Butler request" }, 400);
				if (error instanceof TRPCError)
					return c.json(
						{ error: error.message, code: error.code },
						httpFailure(error).status,
					);
				return c.json({ error: "Butler request failed" }, 500);
			}
		});
	}
	const paths = createOpenApiPaths(definitions, "Butler result");
	return { paths };
}
