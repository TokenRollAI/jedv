import { randomUUID } from "node:crypto";
import { peerAckSchema } from "@jedv/shared/teamwork-peers";
import { atomic } from "../memory/sqlite";
import { type OutboxRow, outboxColumns, type PeerService } from "./service";
export const MAX_OUTBOX_ATTEMPTS = 8;
export interface PeerClock {
	now(): number;
	schedule(callback: () => void, delayMs: number): () => void;
}
export interface PeerTransportInput {
	peerId: string;
	origin: string;
	path: "/api/v1/mail/peer-ingest";
	headers: Record<string, string>;
	body: string;
	signal: AbortSignal;
}
export interface PeerRuntimeTestHooks {
	clock?: PeerClock;
	transport?: (request: PeerTransportInput) => Promise<Response>;
	localHostId?: string;
}
const defaultClock: PeerClock = {
	now: Date.now,
	schedule(callback, delayMs) {
		const timer = setTimeout(callback, delayMs);
		timer.unref();
		return () => clearTimeout(timer);
	},
};
const transport = (r: PeerTransportInput) =>
	fetch(`${r.origin}${r.path}`, {
		method: "POST",
		headers: r.headers,
		body: r.body,
		redirect: "error",
		signal: r.signal,
	});
async function readAck(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing peer acknowledgement");
	let text = "",
		size = 0;
	try {
		const decoder = new TextDecoder();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 8192) throw new Error("Oversized peer acknowledgement");
			text += decoder.decode(value, { stream: true });
		}
		return peerAckSchema.parse(JSON.parse(text));
	} finally {
		await reader.cancel().catch(() => {});
	}
}
export class OutboxForwarder {
	private readonly clock: PeerClock;
	private readonly transport: (input: PeerTransportInput) => Promise<Response>;
	private readonly abort = new AbortController();
	private pending: Promise<void> | undefined;
	private cancelTimer: (() => void) | undefined;
	private again = false;
	constructor(
		readonly service: PeerService,
		hooks: PeerRuntimeTestHooks = {},
	) {
		this.clock = hooks.clock ?? defaultClock;
		this.transport = hooks.transport ?? transport;
		service.db
			.prepare(
				"UPDATE mail_outbox SET status='pending',inflight_token=NULL,next_attempt_at=? WHERE status='inflight'",
			)
			.run(this.clock.now());
		service.on("outbox", this.kick);
	}
	start() {
		return this.kick();
	}
	kick = (): Promise<void> => {
		if (this.abort.signal.aborted) return Promise.resolve();
		this.again = true;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		if (this.pending) return this.pending;
		this.pending = this.pump().finally(() => {
			this.pending = undefined;
			this.schedule();
		});
		return this.pending;
	};
	private schedule() {
		if (this.abort.signal.aborted) return;
		const next = this.service.db
			.prepare(
				"SELECT MIN(o.next_attempt_at) AS due FROM mail_outbox o JOIN peer_hosts p ON p.id=o.target_peer_id WHERE o.status='pending' AND p.enabled=1",
			)
			.get() as { due: number | null };
		if (next.due !== null)
			this.cancelTimer = this.clock.schedule(
				() => void this.kick(),
				Math.max(0, next.due - this.clock.now()),
			);
	}
	private claim(): OutboxRow | undefined {
		return atomic(this.service.db, () => {
			const row = this.service.db
				.prepare(
					"SELECT o.id FROM mail_outbox o JOIN peer_hosts p ON p.id=o.target_peer_id WHERE o.status='pending' AND o.next_attempt_at<=? AND p.enabled=1 ORDER BY o.next_attempt_at,o.created_at,o.id LIMIT 1",
				)
				.get(this.clock.now()) as { id: string } | undefined;
			if (!row) return undefined;
			const lease = randomUUID();
			this.service.db
				.prepare(
					"UPDATE mail_outbox SET status='inflight',inflight_token=? WHERE id=? AND status='pending'",
				)
				.run(lease, row.id);
			const claimed = this.service.db
				.prepare(
					`SELECT ${outboxColumns},envelope_json AS envelopeJson,inflight_token AS inflightToken FROM mail_outbox WHERE id=? AND inflight_token=?`,
				)
				.get(row.id, lease) as OutboxRow | undefined;
			return claimed;
		});
	}
	private async pump() {
		do {
			this.again = false;
			while (!this.abort.signal.aborted) {
				const row = this.claim();
				if (!row) break;
				await this.deliver(row);
			}
		} while (this.again && !this.abort.signal.aborted);
	}
	private async deliver(row: OutboxRow) {
		let error: string | null = null,
			remoteEventId: string | null = null,
			permanent = false;
		try {
			const peer = this.service.peer(row.targetPeerId),
				secret = this.service.secrets.get(peer.id);
			if (!peer.enabled || !secret) throw new Error("Peer unavailable");
			const response = await this.transport({
				peerId: peer.id,
				origin: peer.origin,
				path: "/api/v1/mail/peer-ingest",
				headers: {
					Authorization: `Bearer ${secret}`,
					"X-Jedv-Peer-Id": this.service.options.localHostId,
					"Content-Type": "application/json",
				},
				body: row.envelopeJson,
				signal: AbortSignal.any([
					this.abort.signal,
					AbortSignal.timeout(10_000),
				]),
			});
			if (response.status === 200)
				remoteEventId = (await readAck(response)).remoteEventId;
			else {
				error = `Peer returned HTTP ${response.status}`;
				permanent = [400, 404, 409, 412, 413, 422].includes(response.status);
				await response.body?.cancel();
			}
		} catch {
			error = "Peer transport or acknowledgement failed";
		}
		if (this.abort.signal.aborted) return; // durable inflight is recovered on the next host, using receiver dedupe
		const attempts = row.attemptCount + 1;
		const status = remoteEventId
			? "acked"
			: permanent || attempts >= MAX_OUTBOX_ATTEMPTS
				? "dead"
				: "pending";
		this.service.db
			.prepare(
				"UPDATE mail_outbox SET status=?,inflight_token=NULL,attempt_count=?,next_attempt_at=?,acked_at=?,remote_event_id=?,last_error=? WHERE id=? AND status='inflight' AND inflight_token=?",
			)
			.run(
				status,
				attempts,
				this.clock.now() + Math.min(300_000, 1000 * 2 ** (attempts - 1)),
				remoteEventId ? this.clock.now() : null,
				remoteEventId,
				error,
				row.id,
				row.inflightToken,
			);
	}
	async dispose() {
		this.abort.abort();
		this.cancelTimer?.();
		this.service.off("outbox", this.kick);
		await this.pending;
	}
}
