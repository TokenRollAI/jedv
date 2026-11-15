import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { MAX_AUTO_NUDGE_HOPS, type MailSendInput } from "@jedv/shared/teamwork";
import {
	type OutboxItem,
	type PeerMailIngestEnvelope,
	type PeerSummary,
	type ProviderTokenSummary,
	peerEnvelopeSchema,
	peerUpsertSchema,
	providerEnvelopeSchema,
	providerTokenSchema,
} from "@jedv/shared/teamwork-peers";
import type { z } from "zod";
import type { MailService } from "../mail/service";
import { atomic, type MemorySqlite } from "../memory/sqlite";
import { PeerSecretStore } from "./secret-store";
import { hashToken, payloadHash, problem, sameSecret, token } from "./security";

function requiredRecord<T>(value: T | null | undefined, message: string): T {
	if (value === undefined || value === null) throw new Error(message);
	return value;
}

const peerColumns =
	"id,name,origin,enabled,outbound_token_hint AS outboundTokenHint,created_at AS createdAt,updated_at AS updatedAt";
export const outboxColumns =
	"id,event_id AS eventId,target_peer_id AS targetPeerId,remote_team_id AS remoteTeamId,remote_to AS remoteTo,status,attempt_count AS attemptCount,next_attempt_at AS nextAttemptAt,acked_at AS ackedAt,remote_event_id AS remoteEventId,last_error AS lastError,created_at AS createdAt";
const providerColumns =
	"id,name,extension_id AS extensionId,team_id AS teamId,allowed_to AS allowedTo,type_prefix AS typePrefix,token_hint AS tokenHint,revoked_at AS revokedAt,created_at AS createdAt";
export interface OutboxRow extends OutboxItem {
	envelopeJson: string;
	inflightToken: string | null;
}
export class PeerService extends EventEmitter {
	readonly db: MemorySqlite;
	readonly secrets: PeerSecretStore;
	private readonly changes = new Map<string, Promise<unknown>>();
	private changePeer<T>(
		id: string,
		operation: () => T | Promise<T>,
	): Promise<T> {
		const previous = this.changes.get(id) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(operation);
		this.changes.set(id, next);
		void next
			.finally(() => {
				if (this.changes.get(id) === next) this.changes.delete(id);
			})
			.catch(() => {});
		return next;
	}
	extensionEnabled: (id: string) => boolean = () => false;
	extensionAllows: (id: string, type: string) => boolean = () => false;
	constructor(
		readonly mail: MailService,
		readonly options: {
			home: string;
			localHostId: string;
			now?: () => number;
			isManagementToken?: (raw: string) => boolean | Promise<boolean>;
		},
	) {
		super();
		this.db = mail.team.ctx.db.$client;
		this.secrets = new PeerSecretStore(options.home);
	}
	now = () => (this.options.now ?? Date.now)();
	list(): { localHostId: string; items: PeerSummary[] } {
		return {
			localHostId: this.options.localHostId,
			items: (
				this.db
					.prepare(`SELECT ${peerColumns} FROM peer_hosts ORDER BY name,id`)
					.all() as PeerSummary[]
			).map((p) => ({ ...p, enabled: !!p.enabled })),
		};
	}
	peer(id: string): PeerSummary {
		return (
			this.list().items.find((p) => p.id === id) ??
			problem("NOT_FOUND", "Peer not found")
		);
	}
	async upsert(raw: z.input<typeof peerUpsertSchema>) {
		const x = peerUpsertSchema.parse(raw);
		return this.changePeer(x.id, () => this.upsertNow(x));
	}
	private async upsertNow(x: z.output<typeof peerUpsertSchema>) {
		const now = this.now();
		for (const credential of [x.inboundToken, x.outboundToken])
			if (credential && (await this.options.isManagementToken?.(credential)))
				problem(
					"BAD_REQUEST",
					"A peer credential must be independent of the host management token",
				);
		const previous = this.db
			.prepare("SELECT inbound_token_hash FROM peer_hosts WHERE id=?")
			.get(x.id) as { inbound_token_hash: string } | undefined;
		const inboundToken = x.inboundToken ?? (previous ? undefined : token());
		const oldSecret = this.secrets.get(x.id);
		const secret = x.outboundToken ?? oldSecret;
		if (x.outboundToken) await this.secrets.set(x.id, x.outboundToken);
		try {
			this.db
				.prepare(
					"INSERT INTO peer_hosts(id,name,origin,inbound_token_hash,outbound_token_hint,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,origin=excluded.origin,inbound_token_hash=excluded.inbound_token_hash,outbound_token_hint=excluded.outbound_token_hint,enabled=excluded.enabled,updated_at=excluded.updated_at",
				)
				.run(
					x.id,
					x.name,
					x.origin,
					inboundToken
						? hashToken(inboundToken)
						: requiredRecord(previous, "Peer inbound credential is missing")
								.inbound_token_hash,
					secret ? `••••${secret.slice(-4)}` : null,
					Number(x.enabled),
					now,
					now,
				);
		} catch (error) {
			if (x.outboundToken) await this.secrets.set(x.id, oldSecret);
			throw error;
		}
		this.signal();
		return { peer: this.peer(x.id), ...(inboundToken ? { inboundToken } : {}) };
	}
	async remove(id: string) {
		return this.changePeer(id, () => this.removeNow(id));
	}
	private async removeNow(id: string) {
		this.db.prepare("DELETE FROM peer_hosts WHERE id=?").run(id);
		await this.secrets.set(id, null);
		return { removed: true };
	}
	rotateInbound(id: string) {
		return this.changePeer(id, () => this.rotateInboundNow(id));
	}
	private rotateInboundNow(id: string) {
		this.peer(id);
		const value = token();
		this.db
			.prepare(
				"UPDATE peer_hosts SET inbound_token_hash=?,updated_at=? WHERE id=?",
			)
			.run(hashToken(value), this.now(), id);
		return { inboundToken: value };
	}
	authenticatePeer(id: string, raw: string): string {
		const row = this.db
			.prepare("SELECT inbound_token_hash,enabled FROM peer_hosts WHERE id=?")
			.get(id) as { inbound_token_hash: string; enabled: number } | undefined;
		const matches = sameSecret(
			hashToken(raw),
			row?.inbound_token_hash ?? "0".repeat(64),
		);
		if (!matches || !row?.enabled)
			problem("UNAUTHORIZED", "Invalid peer credential");
		return id;
	}
	outbox(
		input: { peerId?: string; status?: string; limit?: number } = {},
	): OutboxItem[] {
		const clauses: string[] = [],
			args: Array<string | number> = [];
		if (input.peerId) {
			clauses.push("target_peer_id=?");
			args.push(input.peerId);
		}
		if (input.status) {
			clauses.push("status=?");
			args.push(input.status);
		}
		return this.db
			.prepare(
				`SELECT ${outboxColumns} FROM mail_outbox${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC,id LIMIT ?`,
			)
			.all(...args, Math.min(200, input.limit ?? 50)) as OutboxItem[];
	}
	getForEvent(eventId: string): OutboxItem | undefined {
		return this.db
			.prepare(`SELECT ${outboxColumns} FROM mail_outbox WHERE event_id=?`)
			.get(eventId) as OutboxItem | undefined;
	}
	enqueue(
		event: { id: string; threadId: string; hopCount: number },
		input: MailSendInput,
	) {
		const target =
			input.targetPeer ?? problem("BAD_REQUEST", "Missing target peer");
		const peer = this.peer(target.peerId);
		if (!peer.enabled || !this.secrets.get(peer.id))
			problem(
				"PRECONDITION_FAILED",
				"Peer is disabled or has no outbound credential",
			);
		const id = randomUUID(),
			now = this.now();
		const envelope: PeerMailIngestEnvelope = {
			version: 1,
			outboxId: id,
			sourceEventId: event.id,
			remoteTeamId: target.remoteTeamId,
			to: input.to,
			type: input.type,
			subject: input.subject,
			body: input.body,
			payload: input.payload,
			hopCount: event.hopCount,
			threadId: event.threadId,
		};
		peerEnvelopeSchema.parse(envelope);
		this.db
			.prepare(
				"INSERT INTO mail_outbox(id,event_id,target_peer_id,remote_team_id,remote_to,envelope_json,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,'pending',?,?)",
			)
			.run(
				id,
				event.id,
				peer.id,
				target.remoteTeamId,
				input.to,
				JSON.stringify(envelope),
				now,
				now,
			);
		return requiredRecord(
			this.getForEvent(event.id),
			"Created outbox item is missing",
		);
	}
	retryDeadOutbox(id: string) {
		const row = this.db
			.prepare(`SELECT ${outboxColumns} FROM mail_outbox WHERE id=?`)
			.get(id) as OutboxItem | undefined;
		if (!row) problem("NOT_FOUND", "Outbox item not found");
		if (row.status !== "dead")
			problem("CONFLICT", "Only dead outbox items can be retried");
		this.db
			.prepare(
				"UPDATE mail_outbox SET status='pending',inflight_token=NULL,attempt_count=0,next_attempt_at=?,last_error=NULL WHERE id=? AND status='dead'",
			)
			.run(this.now(), id);
		this.signal();
		return requiredRecord(
			this.getForEvent(row.eventId),
			"Retried outbox item is missing",
		);
	}
	signal() {
		this.emit("outbox");
	}
	private receive(
		namespace: string,
		sourceEventId: string,
		request: unknown,
		input: {
			teamId: string;
			to: string;
			type: string;
			subject: string;
			body: string;
			payload?: Record<string, unknown>;
			hop: number;
			threadId?: string;
			sourceKind: "peer" | "provider";
			sourceId: string;
		},
	) {
		const hash = payloadHash(request);
		const result = atomic(this.db, () => {
			const receipt = this.db
				.prepare(
					"SELECT local_event_id,request_fingerprint FROM mail_inbound_receipts WHERE source_namespace=? AND source_event_id=?",
				)
				.get(namespace, sourceEventId) as
				| { local_event_id: string; request_fingerprint: string }
				| undefined;
			if (receipt) {
				if (receipt.request_fingerprint !== hash)
					problem("CONFLICT", "Idempotency key has different content");
				return {
					ok: true as const,
					remoteEventId: receipt.local_event_id,
					duplicate: true,
				};
			}
			const team = this.mail.team.resolve({ teamId: input.teamId });
			if (team.status === "archived")
				problem("PRECONDITION_FAILED", "Archived Team cannot receive mail");
			const recipients =
				input.to === "team"
					? this.mail.team.members(team.id).filter((m) => m.status === "active")
					: [
							input.to === "leader"
								? (this.mail.team
										.members(team.id)
										.find((m) => m.role === "leader") ??
									problem("NOT_FOUND", "Leader not found"))
								: this.mail.team.findMember(team.id, input.to),
						];
			if (!recipients.length) problem("NOT_FOUND", "No recipients");
			const eventId = randomUUID(),
				now = this.now();
			this.db
				.prepare(
					"INSERT INTO mail_events(id,team_id,thread_id,type,source_kind,source_id,dedupe_key,request_fingerprint,hop_count,subject,body,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
				)
				.run(
					eventId,
					team.id,
					input.threadId ?? eventId,
					input.type,
					input.sourceKind,
					input.sourceId,
					sourceEventId,
					hash,
					input.hop,
					input.subject,
					input.body,
					input.payload ? JSON.stringify(input.payload) : null,
					now,
				);
			for (const member of recipients)
				this.db
					.prepare(
						"INSERT INTO mail_deliveries(id,event_id,recipient_member_id,nudge_state,created_at) VALUES(?,?,?,?,?)",
					)
					.run(
						randomUUID(),
						eventId,
						member.id,
						member.status !== "active" ||
							!["active", "paused"].includes(team.status)
							? "not_applicable"
							: input.hop >= MAX_AUTO_NUDGE_HOPS
								? "suppressed_hop_limit"
								: "pending",
						now,
					);
			this.db
				.prepare(
					"INSERT INTO mail_inbound_receipts(source_namespace,source_event_id,request_fingerprint,local_event_id,received_at) VALUES(?,?,?,?,?)",
				)
				.run(namespace, sourceEventId, hash, eventId, now);
			return { ok: true as const, remoteEventId: eventId, duplicate: false };
		});
		if (!result.duplicate)
			this.mail.notifyExternal(input.teamId, result.remoteEventId);
		return result;
	}
	ingestPeer(peerId: string, raw: unknown) {
		const x = peerEnvelopeSchema.parse(raw);
		return this.receive(`peer:${peerId}`, x.sourceEventId, x, {
			teamId: x.remoteTeamId,
			to: x.to,
			type: x.type,
			subject: x.subject,
			body: x.body,
			payload: x.payload,
			hop: x.hopCount + 1,
			threadId: x.threadId,
			sourceKind: "peer",
			sourceId: peerId,
		});
	}
	listProviderTokens(): ProviderTokenSummary[] {
		return this.db
			.prepare(
				`SELECT ${providerColumns} FROM mail_provider_tokens ORDER BY created_at DESC`,
			)
			.all() as ProviderTokenSummary[];
	}
	createProviderToken(
		raw: z.input<typeof providerTokenSchema>,
		extensionId: string | null = null,
	) {
		const x = providerTokenSchema.parse(raw);
		const team = this.mail.team.resolve({ teamId: x.teamId });
		if (team.status === "archived")
			problem(
				"PRECONDITION_FAILED",
				"Archived Team cannot receive provider mail",
			);
		if (x.allowedTo !== "team" && x.allowedTo !== "leader")
			this.mail.team.findMember(team.id, x.allowedTo);
		const id = randomUUID(),
			rawToken = token();
		this.db
			.prepare(
				"INSERT INTO mail_provider_tokens(id,name,extension_id,team_id,allowed_to,type_prefix,token_hash,token_hint,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
			)
			.run(
				id,
				x.name,
				extensionId,
				x.teamId,
				x.allowedTo,
				x.typePrefix,
				hashToken(rawToken),
				`••••${rawToken.slice(-4)}`,
				this.now(),
			);
		return {
			token: rawToken,
			provider: requiredRecord(
				this.listProviderTokens().find((p) => p.id === id),
				"Created provider token is missing",
			),
		};
	}
	revokeProviderToken(id: string) {
		this.db
			.prepare(
				"UPDATE mail_provider_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",
			)
			.run(this.now(), id);
		return { revoked: true };
	}
	revokeExtension(id: string) {
		this.db
			.prepare(
				"UPDATE mail_provider_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE extension_id=?",
			)
			.run(this.now(), id);
	}
	authenticateProvider(raw: string): ProviderTokenSummary {
		const hash = hashToken(raw);
		const row = this.db
			.prepare(
				`SELECT ${providerColumns},token_hash FROM mail_provider_tokens WHERE token_hash=?`,
			)
			.get(hash) as (ProviderTokenSummary & { token_hash: string }) | undefined;
		const valid = sameSecret(hash, row?.token_hash ?? "0".repeat(64));
		if (
			!valid ||
			!row ||
			row.revokedAt !== null ||
			(row.extensionId !== null && !this.extensionEnabled(row.extensionId))
		)
			problem("UNAUTHORIZED", "Invalid provider credential");
		return row;
	}
	ingestProvider(provider: ProviderTokenSummary, raw: unknown) {
		const x = providerEnvelopeSchema.parse(raw);
		if (
			provider.extensionId &&
			!this.extensionAllows(provider.extensionId, x.type)
		)
			problem("FORBIDDEN", "Event type is outside extension scope");
		if (
			!x.type.startsWith(provider.typePrefix) ||
			x.type === provider.typePrefix
		)
			problem("FORBIDDEN", "Event type is outside provider scope");
		return this.receive(`provider:${provider.id}`, x.idempotencyKey, x, {
			teamId: provider.teamId,
			to: provider.allowedTo,
			type: x.type,
			subject: x.subject,
			body: x.body,
			payload: x.payload,
			hop: 1,
			sourceKind: "provider",
			sourceId: provider.id,
		});
	}
}
