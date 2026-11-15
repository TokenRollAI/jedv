import { randomBytes, randomUUID } from "node:crypto";
import {
	type MobileSessionShape,
	type MobileSessionSummary,
	mobilePairSchema,
	peerOriginSchema,
} from "@jedv/shared/teamwork-peers";
import type { z } from "zod";
import { atomic, type MemorySqlite } from "../memory/sqlite";
import { hashToken, problem, sameSecret, token } from "../peers/security";
export const PAIR_TTL = 5 * 60_000;
export const MOBILE_SESSION_TTL = 7 * 86_400_000;
const columns =
	"id,label,created_at AS createdAt,last_seen_at AS lastSeenAt,expires_at AS expiresAt,revoked_at AS revokedAt";
export interface MobileSession extends MobileSessionSummary {
	csrfToken: string;
	tokenHash: string;
	secureCookie: boolean;
}
export class MobileAuthService {
	private readonly attempts = new Map<
		string,
		{ count: number; until: number }
	>();
	constructor(
		readonly db: MemorySqlite,
		readonly now: () => number = Date.now,
	) {}
	getOrigin() {
		const row = this.db
			.prepare("SELECT public_origin FROM mobile_settings WHERE id=1")
			.get() as { public_origin: string | null } | undefined;
		const origin =
			row?.public_origin === null || !row
				? null
				: peerOriginSchema.parse(row.public_origin);
		return { origin, mobileUrl: origin ? `${origin}/mobile` : null };
	}
	setOrigin(input: { origin: string | null }) {
		const origin =
			input.origin === null ? null : peerOriginSchema.parse(input.origin);
		return atomic(this.db, () => {
			const changed = this.getOrigin().origin !== origin;
			this.db
				.prepare(
					"INSERT INTO mobile_settings(id,public_origin,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET public_origin=excluded.public_origin,updated_at=excluded.updated_at",
				)
				.run(origin, this.now());
			if (changed) this.revokeAllSessions();
			return { ...this.getOrigin(), revokedSessions: changed };
		});
	}
	createPairingCode() {
		const now = this.now(),
			alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
		const raw = Array.from(
			randomBytes(8),
			(n) => alphabet[n % alphabet.length],
		).join("");
		atomic(this.db, () => {
			this.db
				.prepare(
					"DELETE FROM mobile_pairing_codes WHERE expires_at<=? OR consumed_at IS NOT NULL",
				)
				.run(now);
			const live = this.db
				.prepare(
					"SELECT id FROM mobile_pairing_codes ORDER BY created_at DESC,id DESC",
				)
				.all() as { id: string }[];
			for (const code of live.slice(2))
				this.db
					.prepare("DELETE FROM mobile_pairing_codes WHERE id=?")
					.run(code.id);
			this.db
				.prepare(
					"INSERT INTO mobile_pairing_codes(id,code_hash,created_at,expires_at) VALUES(?,?,?,?)",
				)
				.run(randomUUID(), hashToken(raw), now, now + PAIR_TTL);
		});
		return {
			code: `${raw.slice(0, 4)}-${raw.slice(4)}`,
			expiresAt: now + PAIR_TTL,
		};
	}
	private admit(key: string) {
		const now = this.now();
		for (const [id, entry] of this.attempts)
			if (entry.until <= now) this.attempts.delete(id);
		for (const id of [
			"global",
			this.attempts.size >= 256 ? "overflow" : `client:${key}`,
		]) {
			const entry = this.attempts.get(id) ?? { count: 0, until: now + 60_000 };
			entry.count++;
			this.attempts.set(id, entry);
			if (entry.count > (id === "global" ? 60 : 10))
				problem(
					"TOO_MANY_REQUESTS",
					"Too many pairing attempts; try again later",
				);
		}
	}
	pair(
		raw: z.input<typeof mobilePairSchema>,
		clientKey = "unknown",
		secureCookie = false,
	) {
		this.admit(clientKey);
		const x = mobilePairSchema.parse(raw),
			now = this.now(),
			code = x.code.toUpperCase().replace(/[-\s]/g, "");
		const sessionToken = token(),
			csrfToken = token(),
			id = randomUUID();
		const accepted = atomic(this.db, () => {
			const row = this.db
				.prepare(
					"SELECT id,code_hash,expires_at,consumed_at,failed_attempts FROM mobile_pairing_codes WHERE code_hash=?",
				)
				.get(hashToken(code)) as
				| {
						id: string;
						code_hash: string;
						expires_at: number;
						consumed_at: number | null;
						failed_attempts: number;
				  }
				| undefined;
			const valid = sameSecret(
				hashToken(code),
				row?.code_hash ?? "0".repeat(64),
			);
			if (
				!valid ||
				!row ||
				row.expires_at <= now ||
				row.consumed_at !== null ||
				row.failed_attempts >= 60
			) {
				this.db
					.prepare(
						"UPDATE mobile_pairing_codes SET failed_attempts=failed_attempts+1 WHERE consumed_at IS NULL AND expires_at>?",
					)
					.run(now);
				return false;
			}
			this.db
				.prepare(
					"UPDATE mobile_pairing_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
				)
				.run(now, row.id, now);
			this.db
				.prepare(
					"DELETE FROM mobile_sessions WHERE expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<?)",
				)
				.run(now, now - 86_400_000);
			this.db
				.prepare(
					"INSERT INTO mobile_sessions(id,label,token_hash,csrf_token,created_at,last_seen_at,expires_at,secure_cookie) VALUES(?,?,?,?,?,?,?,?)",
				)
				.run(
					id,
					x.label,
					hashToken(sessionToken),
					csrfToken,
					now,
					now,
					now + MOBILE_SESSION_TTL,
					Number(secureCookie),
				);
			const sessions = this.db
				.prepare(
					"SELECT id FROM mobile_sessions WHERE revoked_at IS NULL ORDER BY created_at DESC,id DESC",
				)
				.all() as { id: string }[];
			for (const old of sessions.slice(32)) this.revokeSession(old.id);
			return true;
		});
		if (!accepted) problem("UNAUTHORIZED", "Invalid or expired pairing code");
		return {
			sessionToken,
			session: {
				sessionId: id,
				label: x.label,
				csrfToken,
				expiresAt: now + MOBILE_SESSION_TTL,
			} satisfies MobileSessionShape,
		};
	}
	cookieSecure(raw: string | undefined, fallback: boolean) {
		const row = this.db
			.prepare(
				"SELECT secure_cookie AS secure FROM mobile_sessions WHERE token_hash=?",
			)
			.get(hashToken(raw ?? "")) as { secure: number } | undefined;
		return row ? !!row.secure : fallback;
	}

	authenticate(raw: string | undefined): MobileSession {
		const hash = hashToken(raw ?? "");
		const row = this.db
			.prepare(
				`SELECT ${columns},csrf_token AS csrfToken,token_hash AS tokenHash,secure_cookie AS secureCookie FROM mobile_sessions WHERE token_hash=?`,
			)
			.get(hash) as MobileSession | undefined;
		const valid = sameSecret(hash, row?.tokenHash ?? "0".repeat(64));
		if (!valid || !row || row.revokedAt !== null || row.expiresAt <= this.now())
			problem("UNAUTHORIZED", "Mobile session is unavailable");
		if (this.now() - row.lastSeenAt >= 60_000)
			this.db
				.prepare("UPDATE mobile_sessions SET last_seen_at=? WHERE id=?")
				.run(this.now(), row.id);
		return row;
	}
	csrf(session: MobileSession, raw: string | undefined) {
		if (!raw || !sameSecret(raw, session.csrfToken))
			problem("FORBIDDEN", "Invalid mobile CSRF token");
	}
	sessionShape(s: MobileSession): MobileSessionShape {
		return {
			sessionId: s.id,
			label: s.label,
			csrfToken: s.csrfToken,
			expiresAt: s.expiresAt,
		};
	}
	listSessions(): MobileSessionSummary[] {
		return this.db
			.prepare(
				`SELECT ${columns} FROM mobile_sessions WHERE expires_at>? ORDER BY created_at DESC LIMIT 100`,
			)
			.all(this.now()) as MobileSessionSummary[];
	}
	revokeSession(sessionId: string) {
		this.db
			.prepare(
				"UPDATE mobile_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",
			)
			.run(this.now(), sessionId);
		return { revoked: true as const };
	}
	revokeAllSessions() {
		this.db
			.prepare("UPDATE mobile_sessions SET revoked_at=COALESCE(revoked_at,?)")
			.run(this.now());
		return { revoked: true as const };
	}
}
