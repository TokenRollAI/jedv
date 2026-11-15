import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mailEvents, teams } from "./schema";
export const peerHosts = sqliteTable("peer_hosts", {
	id: text().primaryKey(),
	name: text().notNull(),
	origin: text().notNull().unique(),
	inboundTokenHash: text("inbound_token_hash").notNull(),
	outboundTokenHint: text("outbound_token_hint"),
	enabled: integer({ mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});
export const mailOutbox = sqliteTable(
	"mail_outbox",
	{
		id: text().primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => mailEvents.id, { onDelete: "cascade" }),
		targetPeerId: text("target_peer_id")
			.notNull()
			.references(() => peerHosts.id, { onDelete: "cascade" }),
		remoteTeamId: text("remote_team_id").notNull(),
		remoteTo: text("remote_to").notNull(),
		envelopeJson: text("envelope_json").notNull(),
		status: text().notNull(),
		inflightToken: text("inflight_token"),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at").notNull(),
		ackedAt: integer("acked_at"),
		remoteEventId: text("remote_event_id"),
		lastError: text("last_error"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		uniqueIndex("mail_outbox_event_peer_unique").on(t.eventId, t.targetPeerId),
		index("mail_outbox_dispatch_idx").on(t.status, t.nextAttemptAt),
	],
);
export const mailInboundReceipts = sqliteTable(
	"mail_inbound_receipts",
	{
		sourceNamespace: text("source_namespace").notNull(),
		sourceEventId: text("source_event_id").notNull(),
		requestFingerprint: text("request_fingerprint").notNull(),
		localEventId: text("local_event_id")
			.notNull()
			.references(() => mailEvents.id, { onDelete: "cascade" }),
		receivedAt: integer("received_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.sourceNamespace, t.sourceEventId] })],
);
export const mailProviderTokens = sqliteTable("mail_provider_tokens", {
	id: text().primaryKey(),
	name: text().notNull(),
	extensionId: text("extension_id"),
	teamId: text("team_id")
		.notNull()
		.references(() => teams.id, { onDelete: "cascade" }),
	allowedTo: text("allowed_to").notNull(),
	typePrefix: text("type_prefix").notNull(),
	tokenHash: text("token_hash").notNull().unique(),
	tokenHint: text("token_hint").notNull(),
	revokedAt: integer("revoked_at"),
	createdAt: integer("created_at").notNull(),
});
export const mobilePairingCodes = sqliteTable("mobile_pairing_codes", {
	id: text().primaryKey(),
	codeHash: text("code_hash").notNull().unique(),
	createdAt: integer("created_at").notNull(),
	expiresAt: integer("expires_at").notNull(),
	failedAttempts: integer("failed_attempts").notNull().default(0),
	consumedAt: integer("consumed_at"),
});
export const mobileSessions = sqliteTable(
	"mobile_sessions",
	{
		id: text().primaryKey(),
		label: text().notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		csrfToken: text("csrf_token").notNull(),
		secureCookie: integer("secure_cookie", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: integer("created_at").notNull(),
		lastSeenAt: integer("last_seen_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		revokedAt: integer("revoked_at"),
	},
	(t) => [index("mobile_sessions_expiry_idx").on(t.expiresAt)],
);

export const mobileSettings = sqliteTable(
	"mobile_settings",
	{
		id: integer().primaryKey(),
		publicOrigin: text("public_origin"),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [check("mobile_settings_singleton", sql`${t.id}=1`)],
);
