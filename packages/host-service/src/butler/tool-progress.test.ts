import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import { Hono } from "hono";
import { registerButlerHttp } from "./http";
import { ButlerService } from "./service";
import { butlerFixture, modelReply, modelTool } from "./test-fixture";
import { type ButlerToolProgress, observeTool } from "./tool-progress";

test("HTTP request history finds an admitted new topic while running and rejects cross-thread lookup", async () => {
	const f = butlerFixture(async () => modelTool("listTeams", {}));
	let start!: () => void;
	const started = new Promise<void>((resolve) => {
		start = resolve;
	});
	let finish!: (value: unknown) => void;
	f.tools.run = async () => {
		start();
		return new Promise((resolve) => {
			finish = resolve;
		});
	};
	const app = new Hono();
	registerButlerHttp({ app, butler: f.service, authenticate: () => true });
	try {
		const response = app.request("/api/v1/butler/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				humanText: "First new topic",
				requestId: "new-topic-running",
				newTopic: true,
			}),
		});
		await started;
		const pending = (await (
			await app.request("/api/v1/butler/history?requestId=new-topic-running")
		).json()) as { threadId: string; role: string; content: string }[];
		expect(
			pending.some(
				(row) =>
					row.role === "tool" && JSON.parse(row.content).status === "running",
			),
		).toBe(true);
		expect(
			await (
				await app.request("/api/v1/butler/history?requestId=not-admitted")
			).json(),
		).toEqual([]);
		expect(
			(
				await app.request(
					"/api/v1/butler/history?requestId=new-topic-running&threadId=another-thread",
				)
			).status,
		).toBe(409);
		const caps = (await (
			await app.request("/api/v1/butler/capabilities")
		).json()) as { features: Record<string, boolean> };
		expect(caps.features.historyByRequest).toBe(true);
		expect(caps.features.toolProgress).toBe(true);
		finish([]);
		await response;
	} finally {
		await f.dispose();
	}
});

test("tool start and heartbeat are persisted before completion; safe result updates the same message", async () => {
	let calls = 0;
	const f = butlerFixture(async () =>
		++calls === 1
			? modelTool("listWorkspaces", { limit: 4 })
			: modelReply("Done"),
	);
	let started!: () => void;
	const start = new Promise<void>((resolve) => {
		started = resolve;
	});
	let finish!: (value: unknown) => void;
	f.tools.run = async () => {
		started();
		return new Promise((resolve) => {
			finish = resolve;
		});
	};
	const callbacks = new Map<number, () => void>();
	const service = new ButlerService({
		db: f.sqlite,
		ai: f.ai,
		tools: f.tools,
		now: () => 1000000,
		toolSchedule: (fn, ms) => {
			callbacks.set(ms, fn);
			return () => {
				callbacks.delete(ms);
			};
		},
	});
	try {
		const pending = service.sendMessage({
			humanText: "List workspaces",
			requestId: "tool-progress",
		});
		await start;
		const first = service.history().find((row) => row.role === "tool");
		assert.ok(first);
		expect(JSON.parse(first.content).status).toBe("running");
		callbacks.get(1000)?.();
		expect(service.history().filter((row) => row.role === "tool")).toHaveLength(
			1,
		);
		finish([{ secret: "sk-secret-in-tool", name: "private workspace" }]);
		await pending;
		const last = service.history().find((row) => row.role === "tool");
		assert.ok(last);
		expect(last.id).toBe(first.id);
		expect(JSON.parse(last.content)).toMatchObject({
			status: "succeeded",
			resultSummary: "1 items",
			parametersSummary: "limit: 4",
		});
		expect(last.content).not.toContain("private workspace");
		expect(last.content).not.toContain("sk-secret");
	} finally {
		await service.dispose();
		await f.dispose();
	}
});

test("failure is visible before final model response and raw error is never persisted", async () => {
	let calls = 0;
	let requested!: () => void;
	const next = new Promise<void>((resolve) => {
		requested = resolve;
	});
	let finish!: (value: Response) => void;
	const f = butlerFixture(async () => {
		if (++calls === 1) return modelTool("listTeams", {});
		requested();
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	f.tools.run = async () => {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Authorization: Bearer super-secret",
		});
	};
	try {
		const pending = f.service.sendMessage({
			humanText: "List teams",
			requestId: "failure",
		});
		await next;
		const tool = f.service.history().find((row) => row.role === "tool");
		assert.ok(tool);
		expect(JSON.parse(tool.content)).toMatchObject({
			status: "failed",
			error: "Tool failed (FORBIDDEN). Inspect the target before retrying.",
		});
		expect(tool.content).not.toContain("super-secret");
		finish(modelReply("Failed"));
		await pending;
	} finally {
		await f.dispose();
	}
});

test("repeated failed tool requests reuse the failure and never replay an uncertain write", async () => {
	let executions = 0;
	const f = butlerFixture(async () =>
		modelTool("renameTeam", { teamId: "isolated", name: "renamed" }),
	);
	f.tools.run = async () => {
		executions++;
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "token=private-value",
		});
	};
	try {
		await f.service.sendMessage({
			humanText: "Rename the isolated Team",
			requestId: "duplicate-failure",
		});
		expect(executions).toBe(1);
		const calls = f.service
			.history()
			.filter((row) => row.role === "tool")
			.map((row) => JSON.parse(row.content));
		expect(calls).toHaveLength(6);
		expect(calls.every((call) => call.status === "failed")).toBe(true);
		expect(calls.slice(1).every((call) => call.reused === true)).toBe(true);
		expect(JSON.stringify(calls)).not.toContain("private-value");
	} finally {
		await f.dispose();
	}
});

test("timeout preserves uncertain execution and ignores late completion without replay", async () => {
	let now = 1,
		runs = 0;
	const callbacks = new Map<number, () => void>();
	const updates: ButlerToolProgress[] = [];
	let complete!: (value: unknown) => void;
	const job = observeTool({
		progress: {
			version: 1,
			tool: "listTeams",
			callId: "one",
			status: "running",
			startedAt: 1,
			updatedAt: 1,
			elapsedMs: 0,
			parametersSummary: "0 fields",
		},
		write: (p) => updates.push({ ...p }),
		run: async () => {
			runs++;
			return new Promise((r) => {
				complete = r;
			});
		},
		clock: {
			now: () => now,
			schedule: (fn, ms) => {
				callbacks.set(ms, fn);
				return () => {
					callbacks.delete(ms);
				};
			},
		},
		signal: new AbortController().signal,
		timeoutMs: 60000,
	});
	await Promise.resolve();
	now = 1001;
	callbacks.get(1000)?.();
	expect(updates.at(-1)?.elapsedMs).toBe(1000);
	const failure = job.catch((error: unknown) => error);
	callbacks.get(60000)?.();
	expect(await failure).toBeInstanceOf(Error);
	expect(updates.at(-1)).toMatchObject({
		status: "interrupted",
		outcomeUnknown: true,
	});
	complete("late");
	await Promise.resolve();
	await Promise.resolve();
	expect(updates.at(-1)?.status).toBe("interrupted");
	expect(runs).toBe(1);
	expect(callbacks.size).toBe(0);
});

test("restart settles stranded running tools and refuses replay of uncertain request", async () => {
	const f = butlerFixture();
	try {
		const first = await f.service.sendMessage({
			humanText: "fixture",
			requestId: "stranded",
		});
		f.sqlite
			.prepare(
				"UPDATE butler_turns SET status='running',result_json=NULL WHERE id=?",
			)
			.run("stranded");
		f.sqlite
			.prepare(
				"INSERT INTO butler_messages(id,thread_id,request_id,role,content,created_at) VALUES(?,?,?,'tool',?,?)",
			)
			.run(
				"stranded-tool",
				first.threadId,
				"stranded",
				JSON.stringify({
					version: 1,
					tool: "listTeams",
					callId: "call",
					status: "running",
					startedAt: 1,
					updatedAt: 1,
					elapsedMs: 0,
					parametersSummary: "0 fields",
				}),
				1,
			);
		const recovered = new ButlerService({
			db: f.sqlite,
			ai: f.ai,
			tools: f.tools,
			now: () => 2000,
		});
		const tool = recovered
			.history({ threadId: first.threadId })
			.find((row) => row.id === "stranded-tool");
		assert.ok(tool);
		expect(JSON.parse(tool.content)).toMatchObject({
			status: "interrupted",
			outcomeUnknown: true,
		});
		expect(() =>
			recovered.sendMessage({ humanText: "fixture", requestId: "stranded" }),
		).toThrow("interrupted");
		await recovered.dispose();
	} finally {
		await f.dispose();
	}
});

test("dispose interrupts observation, retains the audit record and blocks late writes", async () => {
	const f = butlerFixture(async () => modelTool("listTeams", {}));
	let started!: () => void;
	const start = new Promise<void>((resolve) => {
		started = resolve;
	});
	let finish!: (value: unknown) => void;
	f.tools.run = async () => {
		started();
		return new Promise((resolve) => {
			finish = resolve;
		});
	};
	try {
		const pending = f.service.sendMessage({
			humanText: "teams",
			requestId: "dispose",
		});
		await start;
		const closing = f.service.dispose();
		await pending;
		expect(
			JSON.parse(
				f.service.history().find((row) => row.role === "tool")?.content ??
					"null",
			),
		).toMatchObject({ status: "interrupted", outcomeUnknown: true });
		let drained = false;
		void closing.then(() => {
			drained = true;
		});
		await Promise.resolve();
		expect(drained).toBe(false);
		finish([]);
		await closing;
	} finally {
		await f.dispose();
	}
});
