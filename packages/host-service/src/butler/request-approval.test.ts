import { expect, test } from "bun:test";
import { Hono } from "hono";
import { registerButlerHttp } from "./http";
import { ButlerService } from "./service";
import { butlerFixture } from "./test-fixture";

test("direct requests need no model, retain verbatim audit, and reuse one pending card across retries and restart", async () => {
	const f = butlerFixture(async () => {
		throw new Error("Direct requests must never invoke the model");
	});
	try {
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Keep",
			content: "original",
		});
		const input = {
			requestId: "direct",
			humanText: "  please retire\n    this memory  ",
			action: {
				actionType: "deleteMemoryBatch" as const,
				memoryIds: [memory.id],
			},
		};
		const card = f.service.requestApproval(input);
		expect(card.status).toBe("pending");
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
		expect(f.service.history({ threadId: card.threadId })[0]?.content).toBe(
			input.humanText,
		);
		const cards = await Promise.all([
			Promise.resolve().then(() => f.service.requestApproval(input)),
			Promise.resolve().then(() => f.service.requestApproval(input)),
		]);
		expect(cards).toEqual([card, card]);
		expect(f.service.listThreads()).toHaveLength(0);
		expect(f.service.listThreads({ includeAudit: true })).toHaveLength(1);
		const restarted = new ButlerService({
			db: f.sqlite,
			ai: f.ai,
			tools: f.tools,
			now: () => card.createdAt,
		});
		try {
			expect(restarted.requestApproval(input)).toEqual(card);
		} finally {
			await restarted.dispose();
		}
		for (const change of [
			{ humanText: "different" },
			{ threadId: "other" },
			{ action: { ...input.action, memoryIds: ["different"] } },
		])
			expect(() => f.service.requestApproval({ ...input, ...change })).toThrow(
				"different content",
			);
		f.advance(600001);
		expect(f.service.requestApproval(input)).toMatchObject({
			id: card.id,
			status: "expired",
			expiresAt: card.expiresAt,
		});
		expect(f.service.listApprovals({ status: "all" })).toHaveLength(1);
	} finally {
		await f.dispose();
	}
});

test("invalid target rolls back intent and no-model approval still uses snapshot, hash and single claim", async () => {
	const f = butlerFixture();
	try {
		const input = {
			requestId: "rollback",
			humanText: "Retire",
			action: {
				actionType: "deleteMemoryBatch" as const,
				memoryIds: ["missing"],
			},
		};
		expect(() => f.service.requestApproval(input)).toThrow();
		expect(f.service.listThreads()).toHaveLength(0);
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Keep",
			content: "original",
		});
		const card = f.service.requestApproval({
			...input,
			action: { ...input.action, memoryIds: [memory.id] },
		});
		await expect(
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: "0".repeat(64),
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
		const resolution = {
			approvalId: card.id,
			payloadHash: card.payloadHash,
			decision: "approve" as const,
		};
		const results = await Promise.allSettled([
			f.service.resolveApproval(resolution),
			f.service.resolveApproval(resolution),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("removed");
		expect(
			f.service.requestApproval({
				...input,
				action: { ...input.action, memoryIds: [memory.id] },
			}).status,
		).toBe("executed");
	} finally {
		await f.dispose();
	}
});

test("authenticated HTTP direct request shares idempotency; model request IDs cannot be repurposed", async () => {
	const f = butlerFixture();
	try {
		const app = new Hono();
		const api = registerButlerHttp({
			app,
			butler: f.service,
			authenticate: (request) =>
				request.headers.get("Authorization") === "Bearer isolated",
		});
		expect(api.paths["/api/v1/butler/approvals/request"]).toBeTruthy();
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Keep",
			content: "original",
		});
		const input = {
			requestId: "http",
			humanText: "Retire",
			action: {
				actionType: "deleteMemoryBatch" as const,
				memoryIds: [memory.id],
			},
		};
		const send = (auth = true, body = input) =>
			app.request("/api/v1/butler/approvals/request", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(auth ? { Authorization: "Bearer isolated" } : {}),
				},
				body: JSON.stringify(body),
			});
		expect((await send(false)).status).toBe(401);
		const response = await send();
		expect(response.status).toBe(200);
		const card = await response.json();
		expect(await (await send()).json()).toEqual(card);
		expect((await send(true, { ...input, humanText: "changed" })).status).toBe(
			409,
		);
		await f.service.sendMessage({
			requestId: "model",
			humanText: input.humanText,
		});
		expect(() =>
			f.service.requestApproval({ ...input, requestId: "model" }),
		).toThrow("different content");
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
	} finally {
		await f.dispose();
	}
});
