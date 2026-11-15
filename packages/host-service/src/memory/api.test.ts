import { expect, test } from "bun:test";
import type { MemoryClientShape } from "@jedv/shared/memory";
import { Hono } from "hono";
import type { HostServiceContext } from "../types";
import { memoryApiRouter } from "./api";
import { registerMemoryHttp } from "./http";
import { MemoryRuntime, registerMemoryRuntime } from "./runtime";
import { memoryFixture } from "./test-fixture";

test("HTTP authentication, put/list/search/export share the persisted service", async () => {
	const f = memoryFixture();
	try {
		const app = new Hono();
		registerMemoryHttp({
			app,
			memory: f.service,
			authenticate: (req) =>
				req.headers.get("Authorization") === "Bearer isolated-test",
		});
		expect((await app.request("/api/v1/memory?scopeKind=global")).status).toBe(
			401,
		);
		const headers = {
			Authorization: "Bearer isolated-test",
			"Content-Type": "application/json",
		};
		const put = await app.request("/api/v1/memory", {
			method: "POST",
			headers,
			body: JSON.stringify({
				scopeKind: "global",
				title: "唤醒 rule",
				content: "幂等投递",
			}),
		});
		expect(put.status).toBe(200);
		expect(((await put.json()) as { status: string }).status).toBe("active");
		const list = await app.request("/api/v1/memory?scopeKind=global", {
			headers,
		});
		expect(await list.json()).toHaveLength(1);
		const search = await app.request(
			`/api/v1/memory/search?query=${encodeURIComponent("幂等")}`,
			{ headers },
		);
		expect(await search.json()).toHaveLength(1);
		const out = await app.request("/api/v1/memory/export?scopeKind=global", {
			headers,
		});
		expect(((await out.json()) as { entries: unknown[] }).entries).toHaveLength(
			1,
		);
		const invalid = await app.request("/api/v1/memory", {
			method: "POST",
			headers,
			body: JSON.stringify({
				scopeKind: "team",
				title: "missing scope ID",
				content: "invalid",
			}),
		});
		expect(invalid.status).toBe(400);
	} finally {
		await f.dispose();
	}
});
test("typed tRPC exports work with registered runtime and never return raw key", async () => {
	const f = memoryFixture();
	const owner = {};
	const ctx = {
		isAuthenticated: true,
		runtime: owner,
	} as unknown as HostServiceContext;
	const runtime = new MemoryRuntime({
		db: f.db,
		home: () => f.root,
		transcriptHome: () => f.root,
		memory: { projectRoot: () => f.root, isTeamArchived: () => false },
		watchdog: {
			snapshot: () => ({ members: [], mail: [], automationRuns: [] }),
		},
	});
	const unregister = registerMemoryRuntime(owner, runtime);
	try {
		const caller = memoryApiRouter.createCaller(ctx);
		await caller.memory.put({
			scopeKind: "global",
			title: "Rule",
			content: "typed contract",
		});
		expect(await caller.memory.list({ scopeKind: "global" })).toHaveLength(1);
		expect(await caller.aiSettings.get()).toEqual({
			configured: false,
			maskedHint: null,
		});
		const key = `isolated-${crypto.randomUUID()}`;
		const result = await caller.aiSettings.setDeepseekKey({ apiKey: key });
		expect(result.configured).toBe(true);
		expect(JSON.stringify(result)).not.toContain(key);
		expect(await caller.watchdog.listAlerts()).toEqual([]);
		// Compile-time check: the independently exported client shape agrees with the real tRPC router.
		const _compatible: MemoryClientShape["memory"]["put"]["mutate"] = async (
			input,
		) => caller.memory.put(input);
		expect(_compatible).toBeFunction();
		await expect(
			memoryApiRouter
				.createCaller({ ...ctx, isAuthenticated: false })
				.memory.list({ scopeKind: "global" }),
		).rejects.toThrow("authentication");
	} finally {
		unregister();
		await runtime.dispose();
		await f.dispose();
	}
});
