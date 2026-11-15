import { z } from "zod";

export function normalizePeerOrigin(raw: string): string {
	const url = new URL(raw);
	if (
		url.protocol !== "https:" ||
		!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/i.test(url.hostname) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error(
			"Peer origin must be an HTTPS .ts.net origin without credentials, path, query or fragment",
		);
	return url.origin;
}
export const peerOriginSchema = z
	.string()
	.max(2048)
	.transform((value, ctx) => {
		try {
			return normalizePeerOrigin(value);
		} catch {
			ctx.addIssue({
				code: "custom",
				message:
					"Expected an HTTPS .ts.net origin without credentials, path, query or fragment",
			});
			return z.NEVER;
		}
	});
export const peerIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/)
	.refine((x) => x !== "local", "local is reserved");
export const narrowTokenSchema = z
	.string()
	.min(32)
	.max(256)
	.regex(/^[A-Za-z0-9_-]+$/);
export const peerUpsertSchema = z
	.object({
		id: peerIdSchema,
		name: z.string().trim().min(1).max(120),
		origin: peerOriginSchema,
		inboundToken: narrowTokenSchema.optional(),
		outboundToken: narrowTokenSchema.optional(),
		enabled: z.boolean().default(true),
	})
	.strict();
export const targetPeerSchema = z
	.object({ peerId: peerIdSchema, remoteTeamId: z.string().min(1).max(128) })
	.strict();
export const peerEnvelopeSchema = z
	.object({
		version: z.literal(1),
		outboxId: z.string().uuid(),
		sourceEventId: z.string().uuid(),
		remoteTeamId: z.string().min(1).max(128),
		to: z.string().min(1).max(128),
		type: z.string().min(1).max(80),
		subject: z.string().max(1000),
		body: z.string().max(200_000),
		payload: z.record(z.string(), z.unknown()).optional(),
		hopCount: z.number().int().min(0).max(1_000_000),
		threadId: z.string().min(1).max(128),
	})
	.strict();
export type PeerMailIngestEnvelope = z.infer<typeof peerEnvelopeSchema>;
export const peerAckSchema = z
	.object({
		ok: z.literal(true),
		remoteEventId: z.string().uuid(),
		duplicate: z.boolean().optional(),
	})
	.strict();
export const outboxListSchema = z
	.object({
		peerId: peerIdSchema.optional(),
		status: z.enum(["pending", "inflight", "acked", "dead"]).optional(),
		limit: z.number().int().min(1).max(200).default(50),
	})
	.default({ limit: 50 });
export const providerTokenSchema = z
	.object({
		name: z.string().trim().min(1).max(120),
		teamId: z.string().min(1).max(128),
		allowedTo: z.string().min(1).max(128).default("leader"),
		typePrefix: z.string().regex(/^provider\.[a-zA-Z0-9_-]+\.$/),
	})
	.strict();
export const providerEnvelopeSchema = z
	.object({
		idempotencyKey: z.string().min(1).max(128),
		type: z.string().min(1).max(80),
		subject: z.string().max(1000).default(""),
		body: z.string().max(200_000).default(""),
		payload: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export interface PeerSummary {
	id: string;
	name: string;
	origin: string;
	enabled: boolean;
	outboundTokenHint: string | null;
	createdAt: number;
	updatedAt: number;
}
export interface OutboxItem {
	id: string;
	eventId: string;
	targetPeerId: string;
	remoteTeamId: string;
	remoteTo: string;
	status: "pending" | "inflight" | "acked" | "dead";
	attemptCount: number;
	nextAttemptAt: number;
	ackedAt: number | null;
	remoteEventId: string | null;
	lastError: string | null;
	createdAt: number;
}
export interface ProviderTokenSummary {
	id: string;
	name: string;
	extensionId: string | null;
	teamId: string;
	allowedTo: string;
	typePrefix: string;
	tokenHint: string;
	revokedAt: number | null;
	createdAt: number;
}
export const mobilePairSchema = z
	.object({
		code: z.string().min(1).max(32),
		label: z.string().trim().min(1).max(80).default("Mobile"),
	})
	.strict();
export interface MobileSessionSummary {
	id: string;
	label: string;
	createdAt: number;
	lastSeenAt: number;
	expiresAt: number;
	revokedAt: number | null;
}
export interface MobileSessionShape {
	sessionId: string;
	label: string;
	csrfToken: string;
	expiresAt: number;
}
