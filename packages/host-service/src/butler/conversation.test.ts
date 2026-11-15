import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { DeepseekClient } from "../ai/deepseek";
import { registerButlerHttp } from "./http";
import { ButlerService } from "./service";
import { butlerFixture, modelReply } from "./test-fixture";

test("state initializes only metadata, honors a valid preferred once, never follows recent updates or audit", async () => {
	const f = butlerFixture();
	const ai = new DeepseekClient({
		readKey: () => {
			throw Error("state must not read Key");
		},
	});
	const service = new ButlerService({ db: f.sqlite, ai, tools: f.tools });
	try {
		const insert = f.sqlite.prepare(
			"INSERT INTO butler_threads(id,title,kind,created_at,updated_at) VALUES(?,?,?,1,?)",
		);
		insert.run("older", "旧原话", "conversation", 10);
		insert.run("recent", "Recent", "conversation", 20);
		insert.run("audit", "Invisible", "approval_audit", 100);
		expect(service.state({ preferredThreadId: "older" })).toMatchObject({
			currentThreadId: "older",
			thread: { id: "older", kind: "conversation", title: "旧原话" },
		});
		f.sqlite
			.prepare("UPDATE butler_threads SET updated_at=1000 WHERE id='recent'")
			.run();
		expect(service.state({ preferredThreadId: "recent" }).currentThreadId).toBe(
			"older",
		);
		expect(
			f.sqlite.prepare("SELECT count(*) AS n FROM butler_messages").get(),
		).toEqual({ n: 0 });
		expect(
			f.sqlite.prepare("SELECT count(*) AS n FROM butler_turns").get(),
		).toEqual({ n: 0 });
		expect(service.listThreads().map((row) => row.id)).toEqual([
			"recent",
			"older",
		]);
	} finally {
		await service.dispose();
		await f.dispose();
	}
});

test("empty current initializes to null once; drafts and failed admission create no thread or pointer movement", async () => {
	const f = butlerFixture();
	try {
		expect(f.service.history({})).toEqual([]);
		expect(f.service.state().currentThreadId).toBeNull();
		expect(() =>
			f.service.sendMessage({ humanText: "  \n ", newTopic: true }),
		).toThrow();
		f.sqlite.exec(
			"CREATE TRIGGER reject_turn BEFORE INSERT ON butler_turns WHEN NEW.id='reject' BEGIN SELECT RAISE(ABORT,'admission failed'); END;",
		);
		expect(() =>
			f.service.sendMessage({
				requestId: "reject",
				humanText: "Must roll back",
				newTopic: true,
			}),
		).toThrow("admission failed");
		expect(f.service.state().currentThreadId).toBeNull();
		expect(f.service.listThreads({ includeAudit: true })).toHaveLength(0);
		const result = await f.service.sendMessage({
			requestId: "first",
			humanText: "First",
		});
		const next = await f.service.sendMessage({
			requestId: "second",
			humanText: "Second",
		});
		expect(next.threadId).toBe(result.threadId);
		expect(f.service.history({})).toHaveLength(4);
	} finally {
		await f.dispose();
	}
});

test("new topic is accepted while old thread is busy; late completion and replay never roll current backward", async () => {
	const releases = new Map<string, () => void>();
	let calls = 0;
	const f = butlerFixture(async (_url, init) => {
		calls++;
		const body = JSON.parse(String(init?.body));
		const text = body.messages.at(-1).content as string;
		if (text.startsWith("Block"))
			await new Promise<void>((resolve) => releases.set(text, resolve));
		return modelReply(`Answer ${text}`);
	});
	try {
		const r1 = {
			requestId: "r1",
			humanText: "Block old",
			newTopic: true,
			context: { teamId: "team" },
		};
		const p1 = f.service.sendMessage(r1);
		const t1 = f.service.state().currentThreadId;
		expect(f.service.sendMessage(r1)).toBe(p1);
		expect(() =>
			f.service.sendMessage({ requestId: "busy", humanText: "Other" }),
		).toThrow("already responding");
		const r2 = { requestId: "r2", humanText: "Block new", newTopic: true };
		const p2 = f.service.sendMessage(r2);
		const t2 = f.service.state().currentThreadId;
		if (!t1 || !t2)
			throw new Error("Both topics must be persisted before model completion");
		expect(t2 === t1).toBe(false);
		releases.get("Block new")?.();
		await p2;
		releases.get("Block old")?.();
		const first = await p1;
		expect(first.threadId).toBe(t1);
		expect(first.currentThreadId).toBe(t2);
		expect((await f.service.sendMessage(r1)).currentThreadId).toBe(t2);
		expect(f.service.state().currentThreadId).toBe(t2);
		expect(calls).toBe(2);
		for (const change of [
			{ humanText: "Changed" },
			{ newTopic: false },
			{ context: { teamId: "different" } },
		])
			expect(() => f.service.sendMessage({ ...r1, ...change })).toThrow(
				"different content",
			);
		await f.service.sendMessage({
			threadId: t1 ?? undefined,
			requestId: "history",
			humanText: "Continue explicit old",
		});
		expect(f.service.state().currentThreadId).toBe(t2);
		expect(
			f.service.history({ threadId: t1 ?? undefined })[0]?.turnContext,
		).toEqual({ teamId: "team" });
	} finally {
		for (const release of releases.values()) release();
		await f.dispose();
	}
});

test("programmatic approval audits do not initialize or steal current; explicit ownership and restart remain stable", async () => {
	const f = butlerFixture();
	try {
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Fixture",
			content: "keep",
		});
		const action = {
			actionType: "deleteMemoryBatch" as const,
			memoryIds: [memory.id],
		};
		const card = f.service.requestApproval({
			requestId: "audit",
			humanText: "Retire after confirmation",
			action,
		});
		expect(f.sqlite.prepare("SELECT * FROM butler_state").all()).toEqual([]);
		expect(f.service.listThreads()).toHaveLength(0);
		expect(f.service.listThreads({ includeAudit: true })[0]?.kind).toBe(
			"approval_audit",
		);
		const chat = await f.service.sendMessage({
			requestId: "chat",
			humanText: "Real conversation",
		});
		expect(chat.threadId).not.toBe(card.threadId);
		f.service.requestApproval({
			requestId: "explicit",
			threadId: chat.threadId,
			humanText: "Keep attribution",
			action,
		});
		f.service.requestApproval({
			requestId: "other-audit",
			humanText: "Independent audit",
			action,
		});
		expect(f.service.state().currentThreadId).toBe(chat.threadId);
		expect(f.service.listThreads()).toHaveLength(1);
		const restarted = new ButlerService({
			db: f.sqlite,
			ai: new DeepseekClient({ readKey: () => null }),
			tools: f.tools,
		});
		try {
			expect(
				restarted.state({ preferredThreadId: card.threadId }).currentThreadId,
			).toBe(chat.threadId);
			expect(
				(
					await restarted.sendMessage({
						requestId: "chat",
						humanText: "Real conversation",
					})
				).threadId,
			).toBe(chat.threadId);
		} finally {
			await restarted.dispose();
		}
	} finally {
		await f.dispose();
	}
});

test("a crash snapshot after topic admission retains current and refuses uncertain replay without another model call", async () => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const f = butlerFixture(async () => {
		await gate;
		return modelReply("Original process response");
	});
	let job: Promise<unknown> | undefined;
	try {
		const input = {
			requestId: "accepted-before-crash",
			humanText: "Durable topic before response",
			newTopic: true,
		};
		job = f.service.sendMessage(input);
		const pointer = f.service.state().currentThreadId;
		const crashPath = join(f.root, "crash-snapshot.db");
		writeFileSync(crashPath, f.sqlite.serialize());
		const snapshot = new Database(crashPath);
		const recovered = new ButlerService({
			db: snapshot,
			tools: f.tools,
			ai: new DeepseekClient({
				readKey: () => {
					throw Error("Uncertain replay must not read a Key");
				},
			}),
		});
		try {
			expect(recovered.state().currentThreadId).toBe(pointer);
			expect(recovered.history({})[0]?.content).toBe(input.humanText);
			expect(() => recovered.sendMessage(input)).toThrow(
				"interrupted or remains uncertain",
			);
			expect(recovered.state().currentThreadId).toBe(pointer);
			expect(
				snapshot
					.prepare("SELECT status FROM butler_turns WHERE id=?")
					.get(input.requestId),
			).toEqual({ status: "interrupted" });
		} finally {
			await recovered.dispose();
			snapshot.close();
		}
	} finally {
		release();
		await job;
		await f.dispose();
	}
});

test("model receives complete current human, bounded prior context, and freshly reread approval truth; getApprovals is read-only", async () => {
	let observed: Array<{ role: string; content: string }> = [];
	const f = butlerFixture(async (_url, init) => {
		observed = JSON.parse(String(init?.body)).messages;
		return modelReply("Observed current facts");
	});
	try {
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Fixture",
			content: "keep",
		});
		const initial = await f.service.sendMessage({
			humanText: "Start",
			requestId: "start",
		});
		const card = f.service.requestApproval({
			threadId: initial.threadId,
			requestId: "approval",
			humanText: "Approval",
			action: { actionType: "deleteMemoryBatch", memoryIds: [memory.id] },
		});
		for (let i = 0; i < 20; i++)
			f.sqlite
				.prepare(
					"INSERT INTO butler_messages(id,thread_id,request_id,role,content,created_at) VALUES(?,?,?,'assistant',?,1)",
				)
				.run(`old-${i}`, initial.threadId, `old-turn-${i}`, "O".repeat(2500));
		await f.service.resolveApproval({
			approvalId: card.id,
			payloadHash: card.payloadHash,
			decision: "reject",
		});
		const current = "  leading\n" + "原文".repeat(5900) + "\n    tail ";
		await f.service.sendMessage({
			humanText: current,
			requestId: "full",
			context: { approvalId: card.id },
		});
		expect(observed.at(-1)).toEqual({ role: "user", content: current });
		expect(
			observed.filter((message) => message.content === current),
		).toHaveLength(1);
		const history = observed.slice(1, -2);
		expect(history.length).toBeLessThanOrEqual(12);
		expect(
			history.reduce((n, row) => n + row.content.length, 0),
		).toBeLessThanOrEqual(12000);
		expect(history.every((row) => row.content.length <= 2000)).toBe(true);
		const block =
			observed.at(-2)?.content.split(": ").slice(1).join(": ") ?? "";
		expect(block.length).toBeLessThanOrEqual(3000);
		expect(block).toContain('"status":"rejected"');
		expect(block).toContain(card.id);
		const before = f.sqlite.prepare("SELECT total_changes() AS n").get();
		expect(
			await f.tools.run("getApprovals", { approvalId: card.id }),
		).toMatchObject([{ id: card.id, status: "rejected" }]);
		expect(f.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(
			before,
		);
		expect(f.service.history({}).at(-1)?.turnContext).toEqual({
			approvalId: card.id,
		});
	} finally {
		await f.dispose();
	}
});

test("HTTP state/send/history/list expose identical current and preserve programmatic audits", async () => {
	const f = butlerFixture();
	try {
		const app = new Hono();
		registerButlerHttp({
			app,
			butler: f.service,
			authenticate: (req) =>
				req.headers.get("Authorization") === "Bearer fixture",
		});
		const headers = {
			Authorization: "Bearer fixture",
			"Content-Type": "application/json",
		};
		expect((await app.request("/api/v1/butler/state")).status).toBe(401);
		expect(
			await (await app.request("/api/v1/butler/state", { headers })).json(),
		).toEqual({ currentThreadId: null, thread: null });
		const input = {
			requestId: "http",
			humanText: "  HTTP full text\n ",
			newTopic: true,
			context: { approvalId: "reference" },
		};
		const send = (body: unknown) =>
			app.request("/api/v1/butler/messages", {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
		const result = (await (await send(input)).json()) as {
			threadId: string;
			currentThreadId: string;
		};
		expect(result.currentThreadId).toBe(result.threadId);
		expect(
			(await send({ ...input, context: { approvalId: "different" } })).status,
		).toBe(409);
		expect(
			(
				await send({
					...input,
					requestId: "illegal",
					threadId: result.threadId,
				})
			).status,
		).toBe(400);
		expect(
			(
				await send({
					...input,
					requestId: "unknown",
					context: { text: "not an id" },
				})
			).status,
		).toBe(400);
		expect(
			await (await app.request("/api/v1/butler/history", { headers })).json(),
		).toMatchObject([
			{ content: input.humanText, turnContext: input.context },
			{ role: "assistant" },
		]);
		expect(
			await (await app.request("/api/v1/butler/threads", { headers })).json(),
		).toMatchObject([{ kind: "conversation" }]);
	} finally {
		await f.dispose();
	}
});
