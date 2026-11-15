import {
	peerAckSchema,
	peerEnvelopeSchema,
	providerEnvelopeSchema,
} from "@jedv/shared/teamwork-peers";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { httpFailure } from "../http/errors";
import { problem } from "./security";
import type { PeerService } from "./service";

export { httpFailure } from "../http/errors";
export const NARROW_INGEST_PATHS = new Set([
	"/api/v1/mail/peer-ingest",
	"/api/v1/mail/provider-ingest",
]);
export function isNarrowIngest(request: Request): boolean {
	return (
		request.method === "POST" &&
		NARROW_INGEST_PATHS.has(new URL(request.url).pathname)
	);
}
export function registerPeerIngest(app: Hono, service: PeerService) {
	for (const path of NARROW_INGEST_PATHS) {
		app.post(path, bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
			try {
				const match = c.req
					.header("Authorization")
					?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
				if (!match) problem("UNAUTHORIZED", "Invalid ingest credential");
				// Authenticate before parsing untrusted JSON. These credentials never reach HostAuth.
				const identity = path.endsWith("peer-ingest")
					? service.authenticatePeer(
							c.req.header("X-Jedv-Peer-Id") ?? "",
							match[1]!,
						)
					: service.authenticateProvider(match[1]!);
				const body: unknown = await c.req.json();
				if (typeof identity === "string")
					service.authenticatePeer(identity, match[1] ?? "");
				else service.authenticateProvider(match[1] ?? "");
				const result =
					typeof identity === "string"
						? service.ingestPeer(identity, body)
						: service.ingestProvider(identity, body);
				return c.json(result);
			} catch (error) {
				const failure = httpFailure(error);
				return c.json({ error: failure.message }, failure.status);
			}
		});
	}
	const post = (
		schema: typeof peerEnvelopeSchema | typeof providerEnvelopeSchema,
		credential: string,
		peer = false,
	) => ({
		post: {
			security: [{ [credential]: [] }],
			...(peer
				? {
						parameters: [
							{
								in: "header",
								name: "X-Jedv-Peer-Id",
								required: true,
								schema: { type: "string" },
							},
						],
					}
				: {}),
			requestBody: {
				required: true,
				content: { "application/json": { schema: z.toJSONSchema(schema) } },
			},
			responses: {
				200: {
					description:
						"Durable host receipt; recipient read/ack is independent",
					content: {
						"application/json": { schema: z.toJSONSchema(peerAckSchema) },
					},
				},
				401: { description: "Invalid narrow credential" },
				409: { description: "Same source event ID with different content" },
			},
		},
	});
	return {
		paths: {
			"/api/v1/mail/peer-ingest": post(peerEnvelopeSchema, "peerIngest", true),
			"/api/v1/mail/provider-ingest": post(
				providerEnvelopeSchema,
				"providerIngest",
			),
		},
		securitySchemes: {
			peerIngest: {
				type: "http",
				scheme: "bearer",
				description:
					"Independent peer ingest token; no host administration authority",
			},
			providerIngest: {
				type: "http",
				scheme: "bearer",
				description:
					"Independent provider token restricted to one Team and event prefix",
			},
		},
	};
}
