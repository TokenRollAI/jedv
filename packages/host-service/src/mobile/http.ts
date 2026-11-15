import { getConnInfo } from "@hono/node-server/conninfo";
import {
	butlerApprovalListSchema,
	butlerHistorySchema,
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
import type { MobileSessionShape } from "@jedv/shared/teamwork-peers";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requireButler } from "../butler/runtime";
import { httpFailure } from "../http/errors";
import { problem } from "../peers/security";
import { requireTeamwork } from "../teams/runtime";
import type { HostServiceContext } from "../types";
import { MOBILE_SESSION_TTL, type MobileAuthService } from "./service";

const COOKIE = "jedv_mobile";
export interface MobilePublicAsset {
	path: string;
	content: string | Uint8Array;
	contentType: string;
	cacheControl: string;
}
export function registerMobileHttp(
	app: Hono,
	ctx: HostServiceContext,
	auth: MobileAuthService,
	options: {
		assets?: ReadonlyArray<MobilePublicAsset>;
		origin?: () => string | null;
	} = {},
) {
	for (const asset of options.assets ?? []) {
		if (
			!/^\/mobile(?:\/[a-zA-Z0-9._/-]+)?\/?$/.test(asset.path) ||
			asset.path.startsWith("/mobile/api") ||
			asset.path.includes("..")
		)
			throw new Error("Invalid public mobile asset path");
		app.get(asset.path, (c) => {
			c.header("Content-Type", asset.contentType);
			c.header("Cache-Control", asset.cacheControl);
			c.header(
				"Content-Security-Policy",
				"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
			);
			c.header("X-Content-Type-Options", "nosniff");
			c.header("Referrer-Policy", "no-referrer");
			return c.body(asset.content as string);
		});
	}
	app.use("/mobile/api/*", bodyLimit({ maxSize: 32 * 1024 }));
	app.all("/mobile/api/*", async (c) => {
		c.header("Cache-Control", "no-store");
		c.header("Vary", "Cookie, Origin");
		c.header("X-Content-Type-Options", "nosniff");
		let secure = false;
		try {
			const url = new URL(c.req.url),
				configuredOrigin = options.origin
					? options.origin()
					: auth.getOrigin().origin;
			const origin = c.req.header("Origin")?.trim() || null;
			const site = c.req.header("Sec-Fetch-Site")?.trim() || null;
			if (site && site !== "same-origin" && site !== "none")
				problem("FORBIDDEN", "Cross-site mobile request rejected");
			if (c.req.method === "POST" && !origin)
				problem("FORBIDDEN", "Origin header is required for mobile mutations");
			const loopback =
				url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
			const remote = configuredOrigin !== null && origin === configuredOrigin;
			const local =
				configuredOrigin === null && loopback && origin === url.origin;
			if (origin !== null && !remote && !local)
				problem(
					"FORBIDDEN",
					!configuredOrigin && origin.startsWith("https:")
						? "Configure a verified HTTPS .ts.net mobile origin before remote access"
						: "Mobile request origin does not match",
				);
			if (origin === null && !loopback && !configuredOrigin)
				problem(
					"FORBIDDEN",
					"Configure a verified HTTPS .ts.net mobile origin before remote access",
				);
			secure = !!configuredOrigin || url.protocol === "https:" || !loopback;

			const path = url.pathname,
				method = c.req.method;
			const checkCurrentOrigin = () => {
				const current = options.origin
					? options.origin()
					: auth.getOrigin().origin;
				if (current !== configuredOrigin)
					problem("UNAUTHORIZED", "Mobile origin changed during request");
			};
			const mutationBody = async () => {
				const body = await c.req.json();
				// The body is untrusted IO: authorization must still hold at mutation admission.
				const current = auth.authenticate(getCookie(c, COOKIE));
				auth.csrf(current, c.req.header("x-jedv-mobile-csrf"));
				checkCurrentOrigin();
				return body;
			};
			if (path === "/mobile/api/pair" && method === "POST") {
				let address = "unknown";
				try {
					address = getConnInfo(c).remote.address ?? address;
				} catch {
					/* Unknown adapters share a conservative rate bucket. */
				}
				const body = await c.req.json();
				checkCurrentOrigin();
				const paired = auth.pair(body, address, secure);
				setCookie(c, COOKIE, paired.sessionToken, {
					httpOnly: true,
					sameSite: "Strict",
					secure,
					path: "/mobile",
					maxAge: MOBILE_SESSION_TTL / 1000,
				});
				return c.json(paired.session);
			}
			const session = auth.authenticate(getCookie(c, COOKIE));
			if (!["GET", "POST"].includes(method))
				return c.json({ error: "Not found" }, 404);
			if (method === "POST")
				auth.csrf(session, c.req.header("x-jedv-mobile-csrf"));
			let result: unknown;
			if (path === "/mobile/api/session" && method === "GET")
				result = auth.sessionShape(session) satisfies MobileSessionShape;
			else if (path === "/mobile/api/logout" && method === "POST") {
				auth.revokeSession(session.id);
				deleteCookie(c, COOKIE, {
					path: "/mobile",
					secure: session.secureCookie,
				});
				result = { loggedOut: true };
			} else if (path === "/mobile/api/butler/state" && method === "GET")
				result = requireButler(ctx).state(
					butlerStateQuerySchema.parse({
						preferredThreadId:
							url.searchParams.get("preferredThreadId") ?? undefined,
					}),
				);
			else if (path === "/mobile/api/butler/threads" && method === "GET") {
				const audit = url.searchParams.get("includeAudit");
				result = requireButler(ctx).listThreads(
					butlerThreadListSchema.parse({
						limit: url.searchParams.has("limit")
							? Number(url.searchParams.get("limit"))
							: undefined,
						includeAudit:
							audit === null
								? undefined
								: audit === "true"
									? true
									: audit === "false"
										? false
										: audit,
					}),
				);
			} else if (path === "/mobile/api/butler/history" && method === "GET") {
				const messages = requireButler(ctx).history(
					butlerHistorySchema.parse({
						threadId: url.searchParams.get("threadId") ?? undefined,
						beforeId: url.searchParams.get("beforeId") ?? undefined,
						limit: url.searchParams.has("limit")
							? Number(url.searchParams.get("limit"))
							: undefined,
					}),
				);
				const readTurn = ctx.db.$client.prepare(
					"SELECT result_json FROM butler_turns WHERE id=?",
				);
				result = messages.map((message) => {
					if (message.role !== "assistant") return message;
					let degradedReason: "no_key" | "unavailable" | "budget" | null = null;
					const row = readTurn.get(message.requestId) as
						| { result_json: string | null }
						| undefined;
					if (row?.result_json) {
						try {
							const reason: unknown = JSON.parse(row.result_json)?.reason;
							if (
								reason === "no_key" ||
								reason === "unavailable" ||
								reason === "budget"
							)
								degradedReason = reason;
						} catch {}
					}
					return { ...message, degradedReason };
				});
			} else if (path === "/mobile/api/butler/send" && method === "POST")
				result = await requireButler(ctx).sendMessage(
					butlerSendSchema.strict().parse(await mutationBody()),
				);
			else if (path === "/mobile/api/inbox" && method === "GET")
				result = await requireButler(ctx).inbox(
					attentionQuerySchema.parse({
						view: url.searchParams.get("view") ?? undefined,
						limit: url.searchParams.has("limit")
							? Number(url.searchParams.get("limit"))
							: undefined,
					}),
				);
			else if (path === "/mobile/api/attention/read" && method === "POST")
				result = requireButler(ctx).markAttentionRead(
					attentionSelectorSchema.parse(await mutationBody()),
				);
			else if (path === "/mobile/api/attention/ignore" && method === "POST")
				result = requireButler(ctx).ignoreAttention(
					attentionIgnoreSchema.parse(await mutationBody()),
				);
			else if (path === "/mobile/api/approvals" && method === "GET") {
				result = await requireButler(ctx).listApprovalsWithSources(
					butlerApprovalListSchema.parse({
						status: url.searchParams.get("status") ?? undefined,
						threadId: url.searchParams.get("threadId") ?? undefined,
						approvalId: url.searchParams.get("approvalId") ?? undefined,
						limit: url.searchParams.has("limit")
							? Number(url.searchParams.get("limit"))
							: undefined,
					}),
				);
			} else if (
				/^\/mobile\/api\/approvals\/[^/]+\/resolve$/.test(path) &&
				method === "POST"
			)
				result = await requireButler(ctx).resolveApproval(
					butlerResolveSchema
						.strict()
						.parse({
							...(await mutationBody()),
							approvalId: path.split("/")[4],
						}),
				);
			else if (path === "/mobile/api/status" && method === "GET") {
				const runtime = await requireTeamwork(ctx);
				result = {
					teams: runtime.team.list("active").map((team) => ({
						id: team.id,
						name: team.name,
						goal: team.goal,
						status: team.status,
						members: runtime.team
							.status({ teamId: team.id })
							.members.map((m) => ({
								id: m.id,
								name: m.name,
								role: m.role,
								status: m.status,
								agentId: m.agentId,
								workspaceId: m.workspaceId,
								terminalId: m.terminalId,
								unackedCount: m.unackedCount,
								deliveryState: m.deliveryState,
							})),
					})),
					automations: (ctx.runtime.automations?.list() ?? []).map(
						(automation) => {
							const run = ctx.runtime.automations?.listRuns(automation.id)[0];
							return {
								id: automation.id,
								name: automation.name,
								enabled: automation.enabled,
								nextRunAt: automation.nextRunAt,
								lastRun: run
									? {
											status: run.status,
											createdAt: run.createdAt,
											finishedAt: run.finishedAt,
										}
									: null,
							};
						},
					),
				};
			} else return c.json({ error: "Not found" }, 404);
			return c.json(result as object);
		} catch (error) {
			const failure = httpFailure(error);
			if (failure.status === 401)
				deleteCookie(c, COOKIE, {
					path: "/mobile",
					secure: auth.cookieSecure(getCookie(c, COOKIE), secure),
				});
			return c.json({ error: failure.message }, failure.status);
		}
	});
}
