import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import type {
	ButlerApprovalShape,
	ButlerSendResult,
} from "@jedv/shared/butler";
import type { MobileSessionShape } from "@jedv/shared/teamwork-peers";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
import type { CreateAppResult } from "../app";
import { teamMembers, teams } from "../db/schema";
import type { AppRouter } from "../trpc/router";
import type { PeerClock, PeerTransportInput } from "./outbox-forwarder";

const run = promisify(execFile),
	root = mkdtempSync(join(tmpdir(), "jedv-network-hosts-"));
const cliBin = resolve(import.meta.dirname, "../../../cli/dist/jedv");
function clock() {
	let now = Date.now();
	const timers = new Map<number, { due: number; fn: () => void }>();
	let id = 0;
	return {
		clock: {
			now: () => now,
			schedule(fn: () => void, ms: number) {
				const key = ++id;
				timers.set(key, { due: now + ms, fn });
				return () => {
					timers.delete(key);
				};
			},
		} satisfies PeerClock,
		advance(ms: number) {
			now += ms;
			for (const [key, t] of [...timers])
				if (t.due <= now) {
					timers.delete(key);
					t.fn();
				}
		},
	};
}
type Harness = {
	id: string;
	home: string;
	psk: string;
	teamId: string;
	app: CreateAppResult;
	http: ReturnType<typeof serve>;
	endpoint: string;
	client: ReturnType<typeof createTRPCClient<AppRouter>>;
	clock: ReturnType<typeof clock>;
};
let creating: Harness | undefined;
let a: Harness,
	b: Harness,
	loseAck = false,
	modelRound = 0;
const conversationArrivals = new Map<string, () => void>();
const conversationReleases = new Map<string, () => void>();
let expectedCurrentA: string | undefined;
const transport = async (req: PeerTransportInput) => {
	assert.equal(req.origin, "https://host-b.test.ts.net");
	assert.equal(
		req.headers.Authorization?.includes(a?.psk ?? "not-the-PSK"),
		false,
	);
	const response = await fetch(`${b.endpoint}${req.path}`, {
		method: "POST",
		headers: req.headers,
		body: req.body,
		redirect: "error",
		signal: req.signal,
	});
	if (loseAck) {
		loseAck = false;
		await response.body?.cancel();
		throw new Error("simulated lost ACK after remote commit");
	}
	return response;
};
async function listen(h: Harness) {
	h.http = serve({ fetch: h.app.app.fetch, hostname: "127.0.0.1", port: 0 });
	h.app.injectWebSocket(h.http);
	if (!h.http.listening) await once(h.http, "listening");
	const address = h.http.address();
	assert.ok(address && typeof address !== "string");
	h.endpoint = `http://127.0.0.1:${address.port}`;
	h.client = createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${h.endpoint}/trpc`,
				transformer: SuperJSON,
				headers: { Authorization: `Bearer ${h.psk}` },
			}),
		],
	});
	const dir = join(h.home, "host/jedv-local");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify({
			pid: process.pid,
			endpoint: h.endpoint,
			authToken: h.psk,
			startedAt: Date.now(),
			organizationId: "jedv-local",
		}),
		{ mode: 0o600 },
	);
}
async function boot(id: string, previous?: Harness): Promise<Harness> {
	const home = previous?.home ?? join(root, id);
	mkdirSync(home, { recursive: true });
	const time = previous?.clock ?? clock();
	const fixturePath = resolve(
		import.meta.dirname,
		"../../.cache/node-fixture/host.mjs",
	);
	const { createApp } = (await import(pathToFileURL(fixturePath).href)) as {
		createApp: typeof import("../app")["createApp"];
	};
	const { PskHostAuthProvider } = await import("../providers/host-auth");
	const h = {
		id,
		home,
		psk: previous?.psk ?? randomUUID(),
		teamId: previous?.teamId ?? randomUUID(),
		clock: time,
	} as Harness;
	creating = h;
	h.app = createApp({
		config: {
			organizationId: "jedv-local",
			dbPath: join(home, "host.db"),
			migrationsFolder: resolve(import.meta.dirname, "../../drizzle"),
			allowedOrigins: [],
		},
		providers: {
			hostAuth: new PskHostAuthProvider(h.psk),
			credentials: {
				getCredentials: async () => ({
					env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
				}),
				getToken: async () => null,
				credentialRemedy: () => "No external credentials in this fixture",
			},
		},
		peers: {
			home,
			localHostId: id,
			clock: time.clock,
			...(id === "host-a" ? { transport } : {}),
		},
		memory: {
			home: () => home,
			transcriptHome: () => join(root, "user"),
			deepseek: {
				fetch: async (_url, init) => {
					const body = JSON.parse(String(init?.body));
					assert.equal(body.model, "deepseek-flash");
					const current = body.messages.at(-1)?.content;
					if (
						typeof current === "string" &&
						current.startsWith("__conversation_fixture__")
					) {
						await new Promise<void>((resolve) => {
							conversationReleases.set(current, resolve);
							conversationArrivals.get(current)?.();
						});
						return Response.json({
							choices: [
								{
									finish_reason: "stop",
									message: { content: `Reply ${current}` },
								},
							],
						});
					}
					const first = modelRound++ === 0;
					return Response.json({
						choices: [
							{
								finish_reason: first ? "tool_calls" : "stop",
								message: first
									? {
											content: null,
											tool_calls: [
												{
													id: "stop-proposal",
													type: "function",
													function: {
														name: "requestApproval",
														arguments: JSON.stringify({
															actionType: "stopTeam",
															teamId: h.teamId,
														}),
													},
												},
											],
										}
									: { content: "Please confirm the approval card" },
							},
						],
					});
				},
			},
		},
	});
	await listen(h);
	await h.client.team.capabilities.query().catch(async (error) => {
		console.error("[network-fixture] host boot failed", error);
		await close(h);
		throw error;
	});
	if (!previous) {
		h.app.db
			.insert(teams)
			.values({
				id: h.teamId,
				name: `Team ${id}`,
				goal: "network validation",
				status: "paused",
				createdAt: 1,
				updatedAt: 1,
			})
			.run();
		h.app.db
			.insert(teamMembers)
			.values({
				id: randomUUID(),
				teamId: h.teamId,
				name: "leader",
				role: "leader",
				status: "active",
				agentId: "claude",
				operationId: "init",
				requestFingerprint: "seed",
				requestJson: "{}",
				taskSummary: "test",
				joinedAt: 1,
			})
			.run();
	}
	return h;
}
function countEmails(h: Harness): number {
	return (
		h.app.db.$client.prepare("SELECT count(*) AS n FROM mail_events").get() as {
			n: number;
		}
	).n;
}
async function closeHttp(h: Harness) {
	if (!h.http?.listening) return;
	if ("closeAllConnections" in h.http) h.http.closeAllConnections();
	await new Promise<void>((r) => h.http.close(() => r()));
}
async function close(h: Harness) {
	await closeHttp(h);
	await h.app.dispose();
}
async function cli(h: Harness, args: string[]) {
	const { stdout } = await run(cliBin, [...args, "--local", "--json"], {
		env: {
			...process.env,
			JEDV_HOME_DIR: h.home,
			JEDV_USER_HOME_DIR: join(root, "user"),
			JEDV_TEAM_ID: "",
			JEDV_TEAM_MEMBER_ID: "",
			JEDV_WORKSPACE_ID: "",
			JEDV_TERMINAL_ID: "",
			CI: "1",
		},
		maxBuffer: 2 * 1024 * 1024,
	});
	return JSON.parse(stdout);
}
async function mobile(
	h: Harness,
	path: string,
	options: {
		method?: string;
		cookie?: string;
		csrf?: string;
		body?: unknown;
		origin?: string;
		headers?: Record<string, string>;
	} = {},
) {
	return fetch(`${h.endpoint}/mobile/api/${path}`, {
		method: options.method ?? "GET",
		headers: {
			...(options.cookie ? { Cookie: options.cookie } : {}),
			...(options.csrf ? { "x-jedv-mobile-csrf": options.csrf } : {}),
			...(options.origin ? { Origin: options.origin } : {}),
			...(options.body ? { "Content-Type": "application/json" } : {}),
			...options.headers,
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
}

test(
	"model-independent CLI parity uses real Host services for timeline, automations and hash-bound approvals",
	{ timeout: 30_000 },
	async () => {
		const sent = await a.client.mail.send.mutate({
			teamId: a.teamId,
			to: "leader",
			body: "Timeline parity event",
			dedupeKey: "timeline-parity",
		});
		const timeline = await cli(a, [
			"mail",
			"timeline",
			"--team",
			a.teamId,
			"--human",
			"--limit",
			"100",
		]);
		assert.deepEqual(
			timeline,
			await a.client.mail.timeline.query({ teamId: a.teamId, limit: 100 }),
		);
		const item = timeline[0];
		assert.ok(item);
		assert.equal(item.event.id, sent.event.id);
		assert.equal(item.event.body, "Timeline parity event");
		assert.equal(item.deliveries[0]?.ackedAt, null);
		assert.deepEqual(
			await cli(a, ["automations", "list"]),
			await a.client.automations.list.query(),
		);
		const automation = await a.client.automations.create.mutate({
			name: "Parity inspection",
			prompt: "Do not run",
			agent: "codex",
			enabled: false,
			target: { kind: "workspace", workspaceId: "not-running" },
		});
		assert.ok(
			(await cli(a, ["automations", "list"])).some(
				(item: { id: string }) => item.id === automation.id,
			),
		);
		assert.deepEqual(
			await cli(a, ["automations", "runs", automation.id, "--errors"]),
			[],
		);
		await assert.rejects(
			cli(a, ["automations", "runs", randomUUID()]),
			/Automation not found/,
		);
		const memory = await a.client.memory.put.mutate({
			scopeKind: "global",
			title: "Parity memory",
			content: "isolated",
		});
		const modelCalls = modelRound;
		const action = { actionType: "deleteMemoryBatch", memoryIds: [memory.id] };
		const input = {
			requestId: "cli-parity",
			humanText: "  retire\n    isolated memory  ",
			action,
		};
		const args = [
			"butler",
			"request",
			"--request-id",
			input.requestId,
			"--message",
			input.humanText,
			"--action",
			JSON.stringify(action),
		];
		const card = (await cli(a, args)) as ButlerApprovalShape;
		assert.equal(card.status, "pending");
		assert.deepEqual(await cli(a, args), card);
		const http = (body: unknown, authorized = true) =>
			fetch(`${a.endpoint}/api/v1/butler/approvals/request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(authorized ? { Authorization: `Bearer ${a.psk}` } : {}),
				},
				body: JSON.stringify(body),
			});
		assert.equal((await http(input, false)).status, 401);
		assert.deepEqual(await (await http(input)).json(), card);
		assert.equal((await http({ ...input, humanText: "changed" })).status, 409);
		assert.equal(a.app.memoryRuntime.memory.get(memory.id).status, "active");
		const resolved = await cli(a, [
			"butler",
			"resolve",
			"--approval",
			card.id,
			"--payload-hash",
			card.payloadHash,
			"--decision",
			"approve",
		]);
		assert.equal(resolved.status, "executed");
		assert.equal(a.app.memoryRuntime.memory.get(memory.id).status, "removed");
		assert.equal((await cli(a, args)).status, "executed");
		assert.equal(modelRound, modelCalls);
	},
);
test(
	"Attention real Host and CLI aggregate Mail without ack, reopen new instances, resolve real ack, and enforce Mobile CSRF",
	{ timeout: 30_000 },
	async () => {
		const member = (
			await a.client.team.status.query({ teamId: a.teamId })
		).members.find((row) => row.role === "leader");
		assert.ok(member);
		const deliveryIds: string[] = [];
		for (let index = 0; index < 3; index++) {
			const mail = await a.client.mail.send.mutate({
				teamId: a.teamId,
				to: "leader",
				body: `Attention ${index}`,
				dedupeKey: `attention-${index}`,
			});
			const delivery = mail.deliveries[0];
			assert.ok(delivery);
			deliveryIds.push(delivery.id);
			a.app.db.$client
				.prepare("UPDATE mail_deliveries SET created_at=1 WHERE id=?")
				.run(delivery.id);
		}
		await a.app.memoryRuntime.watchdog.scan();
		const key = `mail_unacked:${a.teamId}:${member.id}`;
		let group = (await a.client.butler.attention.query({})).groups.find(
			(row) => row.groupKey === key,
		);
		assert.ok(group);
		assert.equal(group.activeCount, 3);
		assert.equal(group.totalCount, 3);
		assert.equal((await cli(a, ["butler", "read", key])).updatedCount, 3);
		assert.ok(
			(await cli(a, ["butler", "inbox"])).groups.some(
				(row: { groupKey: string }) => row.groupKey === key,
			),
		);
		assert.equal(
			(
				await cli(a, [
					"butler",
					"ignore",
					key,
					"--reason",
					"Known; still requires ACK",
				])
			).disposition,
			"ignored",
		);
		group = (
			await a.client.butler.attention.query({ view: "handled" })
		).groups.find((row) => row.groupKey === key);
		assert.equal(group?.disposition, "ignored");
		assert.equal(
			(
				a.app.db.$client
					.prepare(
						"SELECT count(*) AS n FROM mail_deliveries WHERE acked_at IS NOT NULL",
					)
					.get() as { n: number }
			).n,
			0,
		);
		const fourth = await a.client.mail.send.mutate({
			teamId: a.teamId,
			to: "leader",
			body: "New attention instance",
			dedupeKey: "attention-four",
		});
		const delivery = fourth.deliveries[0];
		assert.ok(delivery);
		deliveryIds.push(delivery.id);
		a.app.db.$client
			.prepare("UPDATE mail_deliveries SET created_at=1 WHERE id=?")
			.run(delivery.id);
		await a.app.memoryRuntime.watchdog.scan();
		group = (await a.client.butler.attention.query({})).groups.find(
			(row) => row.groupKey === key,
		);
		assert.equal(group?.disposition, "open");
		assert.equal(group?.totalCount, 4);
		for (const deliveryId of deliveryIds)
			await a.client.mail.ack.mutate({
				teamId: a.teamId,
				member: "leader",
				deliveryId,
			});
		await a.app.memoryRuntime.watchdog.scan();
		group = (
			await a.client.butler.attention.query({ view: "handled" })
		).groups.find((row) => row.groupKey === key);
		assert.equal(group?.disposition, "resolved");
		assert.equal(group?.activeCount, 0);
		const faultKey = `team_attention:${a.teamId}:${member.id}`;
		a.app.db.$client
			.prepare(
				"INSERT INTO watchdog_alerts(id,dedupe_key,group_key,severity,kind,subject,body,team_id,member_id,terminal_id,created_at) VALUES('mobile-fault','mobile-fault',?,'high','team_attention','Reconcile','Structured fixture',?,?,'ended-terminal',?)",
			)
			.run(faultKey, a.teamId, member.id, Date.now());
		const beforeModel = modelRound;
		const memory = await a.client.memory.put.mutate({
			scopeKind: "global",
			title: "Attention approval",
			content: "fixture",
		});
		await a.client.butler.requestApproval.mutate({
			requestId: "attention-approval",
			humanText: "Retire after confirmation",
			action: { actionType: "deleteMemoryBatch", memoryIds: [memory.id] },
		});
		const code = await a.client.mobileAuth.createPairingCode.mutate();
		const paired = await mobile(a, "pair", {
			method: "POST",
			origin: a.endpoint,
			body: { code: code.code },
		});
		assert.equal(paired.status, 200);
		const cookie = paired.headers.get("set-cookie")?.split(";")[0];
		assert.ok(cookie);
		const session = (await paired.json()) as MobileSessionShape;
		const mobileInbox = (await (
			await mobile(a, "inbox", { cookie })
		).json()) as Awaited<ReturnType<typeof a.app.butlerService.inbox>>;
		assert.equal(mobileInbox.badge.count, 2);
		const mobileApprovals = (await (
			await mobile(a, "approvals", { cookie })
		).json()) as ButlerApprovalShape[];
		assert.ok(mobileApprovals.some((card) => card.source?.kind === "memory"));
		assert.equal(
			mobileInbox.groups.find((row) => row.groupKey === faultKey)?.source
				.terminalLive,
			false,
		);
		assert.equal(
			(
				await mobile(a, "attention/read", {
					method: "POST",
					origin: a.endpoint,
					cookie,
					body: { groupKey: faultKey },
				})
			).status,
			403,
		);
		const read = await mobile(a, "attention/read", {
			method: "POST",
			origin: a.endpoint,
			cookie,
			csrf: session.csrfToken,
			body: { groupKey: faultKey },
		});
		assert.equal(read.status, 200);
		assert.equal(
			((await read.json()) as { badge: { count: number } }).badge.count,
			1,
		);
		const ignored = await mobile(a, "attention/ignore", {
			method: "POST",
			origin: a.endpoint,
			cookie,
			csrf: session.csrfToken,
			body: { alertId: "mobile-fault", reason: "Known" },
		});
		assert.equal(ignored.status, 200);
		assert.equal(
			((await ignored.json()) as { disposition: string }).disposition,
			"ignored",
		);
		assert.equal(
			(
				await mobile(a, "attention/admin", {
					method: "POST",
					origin: a.endpoint,
					cookie,
					csrf: session.csrfToken,
					body: {},
				})
			).status,
			404,
		);
		assert.equal(
			(
				await mobile(a, "logout", {
					method: "POST",
					origin: a.endpoint,
					cookie,
					csrf: session.csrfToken,
				})
			).status,
			200,
		);
		assert.equal(modelRound, beforeModel);
	},
);
test(
	"conversation actual socket/CLI/HTTP/Mobile keep one durable current, isolate audits, and never rewind on late topic replay",
	{ timeout: 30_000 },
	async () => {
		const initial = await cli(a, [
			"butler",
			"ask",
			"--message",
			"Initial ordinary message",
			"--request-id",
			"conversation-first",
		]);
		const second = await cli(a, [
			"butler",
			"ask",
			"--message",
			"Ordinary follow-up",
			"--request-id",
			"conversation-second",
		]);
		assert.equal(initial.threadId, second.threadId);
		assert.equal(
			(await cli(a, ["butler", "state"])).currentThreadId,
			initial.threadId,
		);
		const rawHeaders = {
			Authorization: `Bearer ${a.psk}`,
			"Content-Type": "application/json",
		};
		assert.equal(
			(await fetch(`${a.endpoint}/api/v1/butler/state`)).status,
			401,
		);
		assert.equal(
			(
				(await (
					await fetch(`${a.endpoint}/api/v1/butler/state`, {
						headers: rawHeaders,
					})
				).json()) as { currentThreadId: string }
			).currentThreadId,
			initial.threadId,
		);
		const r1 = {
			requestId: "conversation-r1",
			newTopic: true,
			humanText: "__conversation_fixture__old",
			context: { teamId: a.teamId },
		};
		const r2 = {
			requestId: "conversation-r2",
			newTopic: true,
			humanText: "__conversation_fixture__new",
		};
		const arrival = (text: string) =>
			new Promise<void>((resolve) => conversationArrivals.set(text, resolve));
		a.app.memoryRuntime.secrets.setDeepseekKey("isolated-fake-key");
		let old: ReturnType<typeof a.client.butler.sendMessage.mutate> | undefined;
		let newer:
			| ReturnType<typeof a.client.butler.sendMessage.mutate>
			| undefined;
		try {
			const oldReady = arrival(r1.humanText);
			old = a.client.butler.sendMessage.mutate(r1);
			await oldReady;
			const t1 = (await a.client.butler.state.query()).currentThreadId;
			assert.ok(t1);
			await assert.rejects(
				a.client.butler.sendMessage.mutate({
					humanText: "Busy current",
					requestId: "conversation-busy",
				}),
				/already responding/,
			);
			const newReady = arrival(r2.humanText);
			newer = a.client.butler.sendMessage.mutate(r2);
			await newReady;
			const t2 = (await a.client.butler.state.query()).currentThreadId;
			assert.ok(t2);
			assert.notEqual(t1, t2);
			conversationReleases.get(r2.humanText)?.();
			await newer;
			conversationReleases.get(r1.humanText)?.();
			assert.equal((await old).currentThreadId, t2);
			const replay = await fetch(`${a.endpoint}/api/v1/butler/messages`, {
				method: "POST",
				headers: rawHeaders,
				body: JSON.stringify(r1),
			});
			assert.equal(replay.status, 200);
			assert.equal(
				((await replay.json()) as ButlerSendResult).currentThreadId,
				t2,
			);
			expectedCurrentA = t2;
		} finally {
			for (const release of conversationReleases.values()) release();
			await Promise.allSettled([old, newer]);
			a.app.memoryRuntime.secrets.setDeepseekKey(null);
		}
		const beforeThreads = (await cli(a, ["butler", "list"])).length;
		const memory = await a.client.memory.put.mutate({
			scopeKind: "global",
			title: "Conversation audit",
			content: "fixture",
		});
		const audit = await cli(a, [
			"butler",
			"request",
			"--request-id",
			"conversation-audit",
			"--message",
			"Audit only",
			"--action",
			JSON.stringify({
				actionType: "deleteMemoryBatch",
				memoryIds: [memory.id],
			}),
		]);
		assert.equal((await cli(a, ["butler", "list"])).length, beforeThreads);
		assert.ok(
			(await cli(a, ["butler", "list", "--include-audit"])).some(
				(row: { id: string; kind: string }) =>
					row.id === audit.threadId && row.kind === "approval_audit",
			),
		);
		assert.equal(
			(await cli(a, ["butler", "state"])).currentThreadId,
			expectedCurrentA,
		);
		const defaultHistory = await cli(a, ["butler", "history"]);
		assert.ok(
			defaultHistory.every(
				(row: { threadId: string }) => row.threadId === expectedCurrentA,
			),
		);
		await cli(a, [
			"butler",
			"ask",
			"--thread",
			initial.threadId,
			"--message",
			"Explicit historical continuation",
			"--request-id",
			"history-continuation",
		]);
		assert.equal(
			(await cli(a, ["butler", "state"])).currentThreadId,
			expectedCurrentA,
		);
		const pair = await a.client.mobileAuth.createPairingCode.mutate();
		const paired = await mobile(a, "pair", {
			method: "POST",
			origin: a.endpoint,
			body: { code: pair.code },
		});
		assert.equal(paired.status, 200);
		const cookie = paired.headers.get("set-cookie")?.split(";")[0];
		assert.ok(cookie);
		const session = (await paired.json()) as MobileSessionShape;
		const state = await mobile(
			a,
			`butler/state?preferredThreadId=${initial.threadId}`,
			{ cookie },
		);
		assert.equal(state.status, 200);
		assert.equal(
			((await state.json()) as { currentThreadId: string }).currentThreadId,
			expectedCurrentA,
		);
		const history = (await (
			await mobile(a, "butler/history", { cookie })
		).json()) as { threadId: string }[];
		assert.ok(history.every((row) => row.threadId === expectedCurrentA));
		const auditCards = (await (
			await mobile(a, `approvals?status=all&threadId=${audit.threadId}`, {
				cookie,
			})
		).json()) as ButlerApprovalShape[];
		assert.deepEqual(
			auditCards.map((card) => card.id),
			[audit.id],
		);
		const normal = await mobile(a, "butler/send", {
			method: "POST",
			origin: a.endpoint,
			cookie,
			csrf: session.csrfToken,
			body: {
				requestId: "mobile-current",
				humanText: "Mobile follows Host current",
			},
		});
		assert.equal(normal.status, 200);
		assert.equal(
			((await normal.json()) as ButlerSendResult).threadId,
			expectedCurrentA,
		);
		assert.equal(
			(
				await mobile(a, "logout", {
					method: "POST",
					origin: a.endpoint,
					cookie,
					csrf: session.csrfToken,
				})
			).status,
			200,
		);
	},
);
before(async () => {
	process.env.JEDV_HOME_DIR = join(root, "global");
	process.env.JEDV_USER_HOME_DIR = join(root, "user");
	process.env.NODE_ENV = "development";
	mkdirSync(process.env.JEDV_HOME_DIR, { recursive: true });
	mkdirSync(process.env.JEDV_USER_HOME_DIR, { recursive: true });
	try {
		b = await boot("host-b");
		a = await boot("host-a");
	} catch (error) {
		console.error("[network-fixture] setup failed", error);
		throw error;
	}
});
after(async () => {
	try {
		for (const h of new Set([a, b, creating])) if (h?.app) await close(h);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test(
	"two isolated complete Hosts exchange over real sockets with narrow credentials, lost ACK, backoff/dead and durable restart",
	{ timeout: 60_000 },
	async () => {
		assert.notEqual(a.psk, b.psk);
		await assert.rejects(
			a.client.peers.upsert.mutate({
				id: "unsafe",
				name: "Unsafe",
				origin: b.endpoint,
			}),
		);
		const inbound = await b.client.peers.upsert.mutate({
			id: "host-a",
			name: "A",
			origin: "https://host-a.test.ts.net",
		});
		assert.ok(inbound.inboundToken);
		const tokenFile = join(root, "peer-outbound.token");
		writeFileSync(tokenFile, inbound.inboundToken, { mode: 0o600 });
		await cli(a, [
			"peers",
			"upsert",
			"--id",
			"host-b",
			"--name",
			"B",
			"--origin",
			"https://host-b.test.ts.net",
			"--outbound-token-file",
			tokenFile,
		]);
		assert.equal((await cli(a, ["peers", "list"])).items.length, 1);
		const denied = await fetch(`${b.endpoint}/api/v1/teams`, {
			headers: { Authorization: `Bearer ${inbound.inboundToken}` },
		});
		assert.equal(denied.status, 401);
		const trpcDenied = await fetch(`${b.endpoint}/trpc/team.list`, {
			headers: { Authorization: `Bearer ${inbound.inboundToken}` },
		});
		assert.equal(trpcDenied.status, 401);
		loseAck = true;
		const sent = await cli(a, [
			"mail",
			"send",
			"--team",
			a.teamId,
			"--to",
			"leader",
			"--body",
			"cross-host durable mail",
			"--dedupe-key",
			"cross-one",
			"--peer",
			"host-b",
			"--remote-team",
			b.teamId,
			"--human",
		]);
		await a.app.teamworkRuntime.outbox.kick();
		let row = (await a.client.peers.outbox.query({}))[0]!;
		assert.equal(row.status, "pending");
		assert.equal(row.attemptCount, 1);
		assert.equal(countEmails(b), 1);
		a.clock.advance(row.nextAttemptAt - a.clock.clock.now());
		await a.app.teamworkRuntime.outbox.kick();
		row = (await a.client.peers.outbox.query({}))[0]!;
		assert.equal(row.status, "acked");
		assert.ok(row.remoteEventId);
		assert.equal(countEmails(b), 1);
		const persisted = a.app.db.$client
			.prepare("SELECT envelope_json FROM mail_outbox WHERE id=?")
			.get(sent.outbox.id) as { envelope_json: string };
		const replay = await fetch(`${b.endpoint}/api/v1/mail/peer-ingest`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${inbound.inboundToken}`,
				"X-Jedv-Peer-Id": "host-a",
				"Content-Type": "application/json",
			},
			body: persisted.envelope_json,
		});
		assert.equal(replay.status, 200);
		assert.equal(
			((await replay.json()) as { duplicate: boolean }).duplicate,
			true,
		);
		const conflict = await fetch(`${b.endpoint}/api/v1/mail/peer-ingest`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${inbound.inboundToken}`,
				"X-Jedv-Peer-Id": "host-a",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...JSON.parse(persisted.envelope_json),
				body: "different",
			}),
		});
		assert.equal(conflict.status, 409);
		await closeHttp(b);
		const offline = await a.client.mail.send.mutate({
			teamId: a.teamId,
			targetPeer: { peerId: "host-b", remoteTeamId: b.teamId },
			to: "leader",
			body: "while disconnected",
			dedupeKey: "offline",
		});
		for (let n = 1; n <= 8; n++) {
			await a.app.teamworkRuntime.outbox.kick();
			const pending = (await a.client.peers.outbox.query({})).find(
				(x) => x.id === offline.outbox?.id,
			)!;
			assert.equal(pending.attemptCount, n);
			if (n < 8) a.clock.advance(pending.nextAttemptAt - a.clock.clock.now());
		}
		assert.equal(
			(await a.client.peers.outbox.query({ status: "dead" })).length,
			1,
		);
		await listen(b);
		await a.client.peers.retryDeadOutbox.mutate({
			outboxId: offline.outbox!.id,
		});
		await a.app.teamworkRuntime.outbox.kick();
		assert.equal(
			(await a.client.peers.outbox.query({ status: "dead" })).length,
			0,
		);
		// Pretend ACK was lost immediately before A died; receiver already has the receipt.
		await a.app.teamworkRuntime.outbox.dispose();
		a.app.db.$client
			.prepare(
				"UPDATE mail_outbox SET status='inflight',inflight_token='crash' WHERE id=?",
			)
			.run(sent.outbox.id);
		const remoteCount = countEmails(b);
		const previous = a;
		await close(a);
		a = await boot("host-a", previous);
		assert.equal(
			(await a.client.butler.state.query()).currentThreadId,
			expectedCurrentA,
		);
		const restoredAttention = await a.client.butler.attention.query({
			view: "handled",
		});
		assert.ok(
			restoredAttention.groups.some(
				(group) =>
					group.kind === "mail_unacked" && group.disposition === "resolved",
			),
		);
		assert.ok(
			restoredAttention.groups.some(
				(group) =>
					group.disposition === "ignored" &&
					group.items.some((item) => item.id === "mobile-fault"),
			),
		);
		await a.app.teamworkRuntime.outbox.kick();
		assert.equal(
			(await a.client.peers.outbox.query({})).find(
				(x) => x.id === sent.outbox.id,
			)?.status,
			"acked",
		);
		assert.equal(countEmails(b), remoteCount);
		assert.deepEqual(
			a.app.db.$client.prepare("PRAGMA foreign_key_check").all(),
			[],
		);
		assert.deepEqual(
			b.app.db.$client.prepare("PRAGMA foreign_key_check").all(),
			[],
		);
	},
);

test(
	"Mobile actual HTTP Serve simulation requires canonical Origin, one-use pairing, CSRF and shared desktop approval claim",
	{ timeout: 45_000 },
	async () => {
		const origin = "https://host-b.test.ts.net";
		const shell = await fetch(`${b.endpoint}/mobile`);
		assert.equal(shell.status, 200);
		assert.ok(
			shell.headers
				.get("content-security-policy")
				?.includes("frame-ancestors 'none'"),
		);
		const manifest = await fetch(`${b.endpoint}/mobile/manifest.webmanifest`);
		assert.equal(manifest.status, 200);
		assert.ok(
			((await manifest.json()) as { icons: unknown[] }).icons.length >= 2,
		);
		assert.equal((await fetch(`${b.endpoint}/mobile/client.js`)).status, 200);
		assert.equal(
			(await fetch(`${b.endpoint}/mobile/service-worker.js`)).headers.get(
				"cache-control",
			),
			"no-cache",
		);

		const code = await b.client.mobileAuth.createPairingCode.mutate();
		assert.equal(
			(
				await mobile(b, "pair", {
					method: "POST",
					body: { code: code.code },
					origin,
					headers: { "X-Forwarded-Proto": "https" },
				})
			).status,
			403,
		);
		await b.client.mobileAuth.setOrigin.mutate({ origin });
		const paired = await mobile(b, "pair", {
			method: "POST",
			body: { code: code.code, label: "Socket phone" },
			origin,
		});
		assert.equal(paired.status, 200);
		const cookieHeader = paired.headers.get("set-cookie")!;
		for (const part of [
			"Secure",
			"HttpOnly",
			"Path=/mobile",
			"SameSite=Strict",
		])
			assert.ok(cookieHeader.includes(part));
		const cookie = cookieHeader.split(";")[0]!,
			session = (await paired.json()) as MobileSessionShape;
		assert.equal(
			(
				await mobile(b, "pair", {
					method: "POST",
					body: { code: code.code },
					origin,
				})
			).status,
			401,
		);
		assert.equal(
			(
				await mobile(b, "butler/send", {
					method: "POST",
					cookie,
					origin,
					body: { humanText: "Stop my team" },
				})
			).status,
			403,
		);
		assert.equal(
			(await mobile(b, "pair", { method: "POST", body: { code: "invalid" } }))
				.status,
			403,
		);
		assert.equal(
			(await mobile(b, "session", { cookie, origin: "https://other.ts.net" }))
				.status,
			403,
		);
		for (const path of [
			"/trpc/team.list",
			"/api/v1/teams",
			"/api/v1/openapi.json",
		])
			assert.equal(
				(await fetch(`${b.endpoint}${path}`, { headers: { Cookie: cookie } }))
					.status,
				401,
			);
		for (const path of ["terminal/write", "filesystem/read", "peers", "config"])
			assert.equal((await mobile(b, path, { cookie, origin })).status, 404);
		const status = await mobile(b, "status", { cookie, origin });
		assert.equal(status.status, 200);
		assert.ok(((await status.json()) as { teams: unknown[] }).teams.length);
		// Actual Butler uses a deterministic model fixture; no external model or key is used.
		b.app.memoryRuntime.secrets.setDeepseekKey(
			"fixture-deepseek-key-for-socket-test",
		);
		const result = await mobile(b, "butler/send", {
			method: "POST",
			cookie,
			csrf: session.csrfToken,
			origin,
			body: { humanText: "Please stop the Team", requestId: randomUUID() },
		});
		assert.equal(result.status, 200);
		const turn = (await result.json()) as ButlerSendResult;
		assert.equal(turn.approvals.length, 1);
		assert.equal(turn.approvals[0]?.status, "pending");
		const card = turn.approvals[0]!,
			resolution = {
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve" as const,
			};
		const [phone, desktop] = await Promise.all([
			mobile(b, `approvals/${card.id}/resolve`, {
				method: "POST",
				cookie,
				csrf: session.csrfToken,
				origin,
				body: { payloadHash: card.payloadHash, decision: "approve" },
			}),
			b.client.butler.resolveApproval.mutate(resolution).then(
				(x) => ({ status: 200, value: x }),
				(error) => ({ status: error.data?.httpStatus ?? 500, value: null }),
			),
		]);
		assert.deepEqual([phone.status, desktop.status].sort(), [200, 409]);
		assert.equal(
			(await b.client.team.status.query({ teamId: b.teamId })).team.status,
			"stopped",
		);
		assert.equal((await mobile(b, "inbox", { cookie, origin })).status, 200);

		b.app.memoryRuntime.secrets.setDeepseekKey(null);
		const noKeyResponse = await mobile(b, "butler/send", {
			method: "POST",
			cookie,
			csrf: session.csrfToken,
			origin,
			body: {
				humanText: "Read-only hello without model key",
				requestId: randomUUID(),
			},
		});
		const noKey = (await noKeyResponse.json()) as ButlerSendResult;
		assert.equal(noKey.reason, "no_key");
		const history = await mobile(
			b,
			`butler/history?threadId=${noKey.threadId}`,
			{ cookie, origin },
		);
		const messages = (await history.json()) as Array<{
			requestId: string;
			role: string;
			content: string;
			degradedReason?: string | null;
		}>;
		assert.equal(
			messages.find(
				(m) => m.role === "assistant" && m.requestId === noKey.requestId,
			)?.degradedReason,
			"no_key",
		);
		assert.equal(
			messages.find(
				(m) => m.role === "assistant" && m.requestId === noKey.requestId,
			)?.content,
			noKey.reply,
		);
		await b.client.mobileAuth.setOrigin.mutate({ origin: null });
		const revoked = await mobile(b, "session", { cookie });
		assert.equal(revoked.status, 401);
		assert.ok(revoked.headers.get("set-cookie")?.includes("Secure"));
	},
);

test(
	"slots real HTTP provider scope, pure-data projection and uninstall revoke integrate with CLI",
	{ timeout: 30_000 },
	async () => {
		const path = join(root, "extension.json");
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				id: "ci",
				name: "CI",
				slots: [
					{
						target: "teamwork.header",
						items: [{ label: "Build", payloadKey: "state" }],
					},
					{
						target: "sidebar.panel",
						cardType: "summary",
						title: "CI",
						items: [{ label: "Count", payloadKey: "count" }],
						url: "https://example.com/build",
					},
					{ target: "mail.provider", eventTypeSuffix: "update" },
				],
			}),
		);
		const installed = await cli(a, [
			"slots",
			"install",
			"--manifest",
			path,
			"--team",
			a.teamId,
		]);
		const secret = installed.providerToken.token;
		const send = (body: unknown) =>
			fetch(`${a.endpoint}/api/v1/mail/provider-ingest`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
		assert.equal(
			(
				await send({
					idempotencyKey: "ci-one",
					type: "provider.ci.update",
					body: "build",
					payload: { state: "ready", count: 2 },
				})
			).status,
			200,
		);
		assert.equal(
			(await send({ idempotencyKey: "bad", type: "provider.ci.other" })).status,
			403,
		);
		assert.equal(
			(
				await send({
					idempotencyKey: "bad",
					type: "provider.ci.update",
					sourceKind: "human",
				})
			).status,
			400,
		);
		assert.equal(
			(
				await fetch(`${a.endpoint}/api/v1/teams`, {
					headers: { Authorization: `Bearer ${secret}` },
				})
			).status,
			401,
		);
		const view = await cli(a, [
			"slots",
			"view",
			"--surface",
			"teamwork.header",
			"--team",
			a.teamId,
		]);
		assert.equal(view[0].items[0].text, "ready");
		await cli(a, ["slots", "uninstall", "--id", "ci"]);
		assert.equal(
			(await send({ idempotencyKey: "ci-two", type: "provider.ci.update" }))
				.status,
			401,
		);
		const mobileConfig = await cli(a, [
			"mobile",
			"origin",
			"--origin",
			"https://host-a.test.ts.net",
		]);
		assert.equal(mobileConfig.mobileUrl, "https://host-a.test.ts.net/mobile");
		assert.ok((await cli(a, ["mobile", "pair-code"])).code);
	},
);
