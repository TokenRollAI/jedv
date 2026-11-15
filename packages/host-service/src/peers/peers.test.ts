import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mailSendSchema } from "@jedv/shared/teamwork";
import { normalizePeerOrigin } from "@jedv/shared/teamwork-peers";
import { MAX_OUTBOX_ATTEMPTS, OutboxForwarder } from "./outbox-forwarder";
import { token } from "./security";
import { networkFixture } from "./test-fixture";

const fixtures: ReturnType<typeof networkFixture>[] = [];
afterEach(async () => {
	for (const f of fixtures.splice(0)) await f.dispose();
});
function fixture() {
	const f = networkFixture();
	fixtures.push(f);
	return f;
}
const envelope = (teamId: string) => ({
	version: 1 as const,
	outboxId: randomUUID(),
	sourceEventId: randomUUID(),
	remoteTeamId: teamId,
	to: "leader",
	type: "agent.message",
	subject: "",
	body: "network",
	threadId: randomUUID(),
	hopCount: 0,
});

test("Peer origins reject unsafe hosts/paths and do not offer a product insecure switch", () => {
	for (const raw of [
		"http://a.ts.net",
		"http://127.0.0.1:1234",
		"https://example.com",
		"https://ts.net",
		"https://bad..ts.net",
		"https://a.ts.net/path",
		"https://u:p@a.ts.net",
		"https://a.ts.net/?secret=x",
		"https://a.ts.net/#x",
	])
		expect(() => normalizePeerOrigin(raw)).toThrow();
	expect(normalizePeerOrigin("https://A.tailnet.ts.net:443/")).toBe(
		"https://a.tailnet.ts.net",
	);
});
test("peer credentials are redacted, stored with restricted mode, and independent from management PSK", async () => {
	const f = fixture(),
		outbound = token();
	const issued = await f.peers.upsert({
		id: "host-b",
		name: "B",
		origin: "https://b.test.ts.net",
		outboundToken: outbound,
	});
	expect(issued.inboundToken).toHaveLength(43);
	expect(JSON.stringify(f.peers.list())).not.toContain(outbound);
	expect(JSON.stringify(f.peers.list())).not.toContain(
		issued.inboundToken ?? "missing",
	);
	expect(statSync(join(f.root, "secrets/peer-tokens.json")).mode & 0o777).toBe(
		0o600,
	);
	expect(
		readFileSync(join(f.root, "secrets/peer-tokens.json"), "utf8"),
	).toContain(outbound);
	await expect(
		f.peers.upsert({
			id: "host-c",
			name: "C",
			origin: "https://c.test.ts.net",
			inboundToken: "management-token-must-not-be-used-as-peer",
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(() => f.peers.authenticatePeer("host-b", outbound)).toThrow();
	expect(f.peers.authenticatePeer("host-b", issued.inboundToken ?? "")).toBe(
		"host-b",
	);
	const rotated = await f.peers.rotateInbound("host-b");
	expect(() =>
		f.peers.authenticatePeer("host-b", issued.inboundToken ?? ""),
	).toThrow();
	expect(f.peers.authenticatePeer("host-b", rotated.inboundToken)).toBe(
		"host-b",
	);
});
test("outgoing mail and outbox share one transaction, retry keys are immutable, and invalid target rolls back the event", async () => {
	const f = fixture();
	await f.peers.upsert({
		id: "host-b",
		name: "B",
		origin: "https://b.test.ts.net",
		outboundToken: token(),
	});
	const input = mailSendSchema.parse({
		teamId: f.teamId,
		targetPeer: { peerId: "host-b", remoteTeamId: "remote-team" },
		to: "leader",
		body: "hello",
		dedupeKey: "same",
	});
	const a = f.mail.send(input),
		b = f.mail.send(input);
	expect(a.event.id).toBe(b.event.id);
	expect(a.outbox?.id).toBe(b.outbox?.id);
	expect(a.deliveries).toEqual([]);
	expect(() => f.mail.send({ ...input, body: "different" })).toThrow(
		"different content",
	);
	expect(() =>
		f.mail.send({
			...input,
			dedupeKey: "bad",
			targetPeer: { ...input.targetPeer!, peerId: "missing" },
		}),
	).toThrow();
	expect(
		f.sqlite.prepare("SELECT count(*) AS n FROM mail_events").get(),
	).toEqual({ n: 1 });
	expect(
		f.sqlite.prepare("SELECT count(*) AS n FROM mail_outbox").get(),
	).toEqual({ n: 1 });
	expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("inbound dedupe persists, same ID different payload conflicts, source remains peer, and hop8 suppresses only this event", () => {
	const f = fixture(),
		x = envelope(f.teamId);
	const a = f.peers.ingestPeer("peer-b", x),
		b = f.peers.ingestPeer("peer-b", x);
	expect(a.remoteEventId).toBe(b.remoteEventId);
	expect(b.duplicate).toBe(true);
	expect(() => f.peers.ingestPeer("peer-b", { ...x, body: "changed" })).toThrow(
		"different content",
	);
	expect(() =>
		f.peers.ingestPeer("peer-b", { ...x, sourceKind: "human" }),
	).toThrow();
	const high = f.peers.ingestPeer("peer-b", {
		...envelope(f.teamId),
		hopCount: 7,
	});
	expect(
		f.sqlite
			.prepare("SELECT nudge_state FROM mail_deliveries WHERE event_id=?")
			.get(high.remoteEventId),
	).toEqual({ nudge_state: "suppressed_hop_limit" });
	expect(
		f.sqlite
			.prepare("SELECT source_kind,hop_count FROM mail_events WHERE id=?")
			.get(a.remoteEventId),
	).toEqual({ source_kind: "peer", hop_count: 1 });
	expect(
		f.sqlite.prepare("SELECT count(*) AS n FROM mail_events").get(),
	).toEqual({ n: 2 });
});
test("Outbox claims once, retries with exact envelope/backoff, caps at dead and explicit retry can ACK", async () => {
	const f = fixture();
	await f.peers.upsert({
		id: "host-b",
		name: "B",
		origin: "https://b.test.ts.net",
		outboundToken: token(),
	});
	let available = false;
	const bodies: string[] = [];
	const forwarder = new OutboxForwarder(f.peers, {
		clock: f.clock,
		transport: async (request) => {
			bodies.push(request.body);
			return available
				? Response.json({ ok: true, remoteEventId: randomUUID() })
				: new Response("offline", { status: 503 });
		},
	});
	try {
		const sent = f.mail.send(
			mailSendSchema.parse({
				teamId: f.teamId,
				targetPeer: { peerId: "host-b", remoteTeamId: "remote" },
				to: "leader",
				body: "hello",
				dedupeKey: "out",
			}),
		);
		for (let n = 1; n <= MAX_OUTBOX_ATTEMPTS; n++) {
			await Promise.all([forwarder.kick(), forwarder.kick()]);
			const row = f.peers.outbox()[0]!;
			expect(row.attemptCount).toBe(n);
			if (n < MAX_OUTBOX_ATTEMPTS) {
				expect(row.nextAttemptAt - f.clock.now()).toBe(
					Math.min(300_000, 1000 * 2 ** (n - 1)),
				);
				f.advance(row.nextAttemptAt - f.clock.now());
			}
		}
		expect(f.peers.outbox()[0]?.status).toBe("dead");
		expect(new Set(bodies).size).toBe(1);
		available = true;
		f.peers.retryDeadOutbox(sent.outbox?.id ?? "");
		await forwarder.kick();
		expect(f.peers.outbox()[0]?.status).toBe("acked");
	} finally {
		await forwarder.dispose();
	}
});
test("permanent remote conflict dies immediately; restart retries durable inflight using the same source event", async () => {
	const f = fixture();
	await f.peers.upsert({
		id: "host-b",
		name: "B",
		origin: "https://b.test.ts.net",
		outboundToken: token(),
	});
	const sent = f.mail.send(
		mailSendSchema.parse({
			teamId: f.teamId,
			targetPeer: { peerId: "host-b", remoteTeamId: "remote" },
			to: "leader",
			dedupeKey: "restart",
		}),
	);
	f.sqlite
		.prepare("UPDATE mail_outbox SET status='inflight',inflight_token='old'")
		.run();
	const source = sent.event.id;
	let seen = "";
	const forwarder = new OutboxForwarder(f.peers, {
		clock: f.clock,
		transport: async (r) => {
			seen = JSON.parse(r.body).sourceEventId;
			return new Response("conflict", { status: 409 });
		},
	});
	await forwarder.start();
	expect(seen).toBe(source);
	expect(f.peers.outbox()[0]).toMatchObject({
		status: "dead",
		attemptCount: 1,
	});
	await forwarder.dispose();
});

test("peer and provider mail cannot reset the recipient nudge rate epoch or obtain more than its bounded budget", async () => {
	const f = fixture(),
		workspaceId = randomUUID(),
		terminalId = randomUUID(),
		launchId = randomUUID();
	f.sqlite
		.prepare(
			"INSERT INTO workspaces(id,project_id,worktree_path,branch,name,type,created_at,updated_at) VALUES(?,NULL,?,'','budget','local',1,1)",
		)
		.run(workspaceId, f.root);
	f.sqlite
		.prepare(
			"INSERT INTO terminal_sessions(id,origin_workspace_id,status,created_at) VALUES(?,?,'active',1)",
		)
		.run(terminalId, workspaceId);
	f.sqlite.prepare("UPDATE teams SET status='active' WHERE id=?").run(f.teamId);
	f.sqlite
		.prepare(
			"UPDATE team_members SET workspace_id=?,terminal_id=?,expected_launch_id=? WHERE id=?",
		)
		.run(workspaceId, terminalId, launchId, f.memberId);
	let writes = 0;
	f.mail.deps.sendAutomatic = async (input) => {
		const idle = f.ctx.terminalAgentStore.acquireAutomaticDelivery(
			input.expectedAgent,
		);
		if (!idle) return { kind: "SESSION_NOT_ACTIVE", error: "not idle" };
		const delivery = await input.acquireDelivery?.();
		if (!delivery?.isValid() || !idle.isValid())
			return { kind: "SESSION_NOT_ACTIVE", error: "lease invalid" };
		writes++;
		return { success: true };
	};
	const binding = {
		terminalId,
		workspaceId,
		agentId: "claude" as const,
		launchId,
		agentSessionId: "budget-native",
		occurredAt: f.clock.now(),
	};
	f.ctx.terminalAgentStore.recordEvent({ ...binding, eventType: "Attached" });
	for (let n = 0; n < 9; n++) {
		f.ctx.terminalAgentStore.recordEvent({
			...binding,
			eventType: "Start",
			hook: { trusted: true, eventType: "Start", sequence: n * 2 + 1 },
		});
		f.peers.ingestPeer("peer-b", envelope(f.teamId));
		f.ctx.terminalAgentStore.recordEvent({
			...binding,
			eventType: "Stop",
			hook: { trusted: true, eventType: "Stop", sequence: n * 2 + 2 },
		});
		await f.mail.flush();
	}
	expect(writes).toBe(8);
	expect(
		f.sqlite
			.prepare(
				"SELECT count(*) AS n FROM mail_deliveries WHERE nudge_state='suppressed_budget'",
			)
			.get(),
	).toEqual({ n: 1 });
	const provider = f.peers.createProviderToken({
		name: "External",
		teamId: f.teamId,
		typePrefix: "provider.external.",
	}).provider;
	f.peers.ingestProvider(provider, {
		idempotencyKey: "new-provider-source",
		type: "provider.external.update",
	});
	await f.mail.flush();
	expect(writes).toBe(8);
	expect(
		f.sqlite
			.prepare(
				"SELECT count(*) AS n FROM mail_deliveries WHERE nudge_state='suppressed_budget'",
			)
			.get(),
	).toEqual({ n: 2 });
	f.advance(60_001);
	await f.mail.flush();
	expect(writes).toBe(9);
});
