import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { butlerApprovals, projects, workspaces } from "../db/schema";
import { ButlerService } from "./service";
import { butlerFixture, modelReply, modelTool } from "./test-fixture";

async function turn(f: ReturnType<typeof butlerFixture>) {
	const r = await f.service.sendMessage({
		humanText: "Please handle this",
		requestId: "request",
	});
	return {
		threadId: r.threadId,
		requestId: r.requestId,
		humanVerbatim: "Please handle this",
	};
}
test("no-key conversations persist, retry is idempotent, changed request conflicts", async () => {
	const f = butlerFixture();
	try {
		const result = await f.service.sendMessage({
			humanText: "  human\n原话 ",
			requestId: "r",
		});
		expect(result.reason).toBe("no_key");
		expect(result.degraded).toBe(true);
		expect(f.service.history({ threadId: result.threadId })[0]?.content).toBe(
			"  human\n原话 ",
		);
		expect(
			await f.service.sendMessage({
				humanText: "  human\n原话 ",
				requestId: "r",
			}),
		).toEqual(result);
		expect(f.service.listThreads()).toHaveLength(1);
		expect(() =>
			f.service.sendMessage({ humanText: "changed", requestId: "r" }),
		).toThrow();
	} finally {
		await f.dispose();
	}
});
test("native tool loop actually reads host data and persists tool results", async () => {
	let round = 0;
	const f = butlerFixture(async (_url, init) => {
		const body = JSON.parse(String(init?.body));
		expect(
			body.tools.some(
				(t: { function: { name: string } }) =>
					t.function.name === "listWorkspaces",
			),
		).toBe(true);
		expect(body.thinking).toEqual({ type: "disabled" });
		if (round++ === 0) return modelTool("listWorkspaces", {});
		const tool = body.messages.find((m: { role: string }) => m.role === "tool");
		expect(tool.tool_call_id).toBe("call1");
		expect(tool.content).toContain("Workspace name");
		return modelReply("Workspace name is active");
	});
	try {
		f.db
			.insert(projects)
			.values({ id: "p", name: "P", repoPath: f.root })
			.run();
		f.db
			.insert(workspaces)
			.values({
				id: "w",
				name: "Workspace name",
				projectId: "p",
				branch: "main",
				worktreePath: f.root,
			})
			.run();
		const result = await f.service.sendMessage({
			humanText: "List workspaces",
		});
		expect(result.reply).toBe("Workspace name is active");
		expect(result.degraded).toBe(false);
		expect(
			f.service.history({ threadId: result.threadId }).map((m) => m.role),
		).toEqual(["human", "tool", "assistant"]);
	} finally {
		await f.dispose();
	}
});
test("model can propose guarded intent but cannot delete until hash-bound approval; concurrent approve claims once", async () => {
	let round = 0;
	let memoryId = "";
	const f = butlerFixture(async () =>
		round++ === 0
			? modelTool("requestApproval", {
					actionType: "deleteMemoryBatch",
					memoryIds: [memoryId],
				})
			: modelReply("Please approve the card"),
	);
	try {
		memoryId = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Keep",
			content: "fact",
		}).id;
		const response = await f.service.sendMessage({
			humanText: "Delete the selected memory",
		});
		const card = response.approvals[0]!;
		expect(card.status).toBe("pending");
		expect(f.memory.runtime.memory.get(memoryId).status).toBe("active");
		await expect(
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: "a".repeat(64),
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const results = await Promise.allSettled([
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve",
			}),
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve",
			}),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(f.memory.runtime.memory.get(memoryId).status).toBe("removed");
		expect(f.service.listApprovals({ status: "history" })[0]?.status).toBe(
			"executed",
		);
		await expect(
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	} finally {
		await f.dispose();
	}
});
test("rejection, expiry and target drift have no destructive side effects", async () => {
	const f = butlerFixture();
	try {
		const t = await turn(f);
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Keep",
			content: "original",
		});
		const action = {
			actionType: "deleteMemoryBatch" as const,
			memoryIds: [memory.id],
		};
		const rejected = f.service.createApproval(action, t);
		expect(
			(
				await f.service.resolveApproval({
					approvalId: rejected.id,
					payloadHash: rejected.payloadHash,
					decision: "reject",
				})
			).status,
		).toBe("rejected");
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
		const expired = f.service.createApproval(action, {
			...t,
			requestId: "next",
		});
		f.advance(600001);
		await expect(
			f.service.resolveApproval({
				approvalId: expired.id,
				payloadHash: expired.payloadHash,
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(
			f.service
				.listApprovals({ status: "history" })
				.some((a) => a.status === "expired"),
		).toBe(true);
		const drift = f.service.createApproval(action, {
			...t,
			requestId: "drift",
		});
		f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "New",
			content: "replacement",
			supersedeId: memory.id,
		});
		await expect(
			f.service.resolveApproval({
				approvalId: drift.id,
				payloadHash: drift.payloadHash,
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
	} finally {
		await f.dispose();
	}
});
test("global candidate adoption and supersede only execute after approval", async () => {
	const f = butlerFixture();
	try {
		const t = await turn(f);
		const prior = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Preference",
			content: "old preference",
		});
		const candidate = f.memory.runtime.memory.propose({
			scopeKind: "global",
			scopeId: "",
			title: "Preference",
			content: "new preference",
			tier: "core",
			category: "convention",
			sourceRef: "terminal",
		});
		await expect(
			f.tools.run("reviewMemory", { id: candidate.id, action: "accept" }, t),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		const card = f.service.createApproval(
			{
				actionType: "acceptGlobalMemory",
				memoryId: candidate.id,
				supersedeId: prior.id,
			},
			t,
		);
		expect(f.memory.runtime.memory.get(candidate.id).status).toBe("candidate");
		await f.service.resolveApproval({
			approvalId: card.id,
			payloadHash: card.payloadHash,
			decision: "approve",
		});
		expect(f.memory.runtime.memory.get(candidate.id).status).toBe("active");
		expect(f.memory.runtime.memory.get(prior.id).supersededById).toBe(
			candidate.id,
		);
	} finally {
		await f.dispose();
	}
});
test("alert-only/no-human context refuses every write tool, including Safe writes and approval creation", async () => {
	const f = butlerFixture();
	try {
		for (const [name, args] of [
			["renameTeam", { teamId: "t", name: "Injected" }],
			["renameWorkspace", { workspaceId: "w", name: "Injected" }],
			["sendMailToLeader", { teamId: "t", body: "stop now" }],
			["requestApproval", { actionType: "stopTeam", teamId: "t" }],
			[
				"putMemory",
				{ scopeKind: "global", title: "Injected", content: "untrusted" },
			],
		] as const)
			await expect(f.tools.run(name, args)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		expect(await f.tools.run("listWorkspaces", {})).toEqual([]);
		expect(f.service.listApprovals()).toEqual([]);
	} finally {
		await f.dispose();
	}
});
test("execution failure becomes terminal failed; restart never replays claimed actions", async () => {
	const f = butlerFixture();
	try {
		const t = await turn(f),
			row = f.memory.runtime.memory.put({
				scopeKind: "global",
				title: "Keep",
				content: "fact",
			});
		const card = f.service.createApproval(
			{ actionType: "deleteMemoryBatch", memoryIds: [row.id] },
			t,
		);
		const original = f.tools.execute.bind(f.tools);
		let calls = 0;
		f.tools.execute = async () => {
			calls++;
			throw new Error("private error must stay on host");
		};
		const result = await f.service.resolveApproval({
			approvalId: card.id,
			payloadHash: card.payloadHash,
			decision: "approve",
		});
		expect(result.status).toBe("failed");
		expect(result.error).not.toContain("private error");
		expect(calls).toBe(1);
		f.tools.execute = original;
		const stranded = f.service.createApproval(
			{ actionType: "deleteMemoryBatch", memoryIds: [row.id] },
			{ ...t, requestId: "stranded" },
		);
		f.db
			.update(butlerApprovals)
			.set({ status: "claimed" })
			.where(eq(butlerApprovals.id, stranded.id))
			.run();
		const restarted = new ButlerService({
			db: f.sqlite,
			ai: f.ai,
			tools: f.tools,
		});
		expect(
			restarted
				.listApprovals({ status: "history" })
				.find((a) => a.id === stranded.id)?.status,
		).toBe("failed");
		expect(f.memory.runtime.memory.get(row.id).status).toBe("active");
		await restarted.dispose();
	} finally {
		await f.dispose();
	}
});
test("tool loop is bounded and repeated guarded intents do not multiply approvals", async () => {
	let id = "",
		calls = 0;
	const f = butlerFixture(async () => {
		calls++;
		return modelTool(
			"requestApproval",
			{ actionType: "deleteMemoryBatch", memoryIds: [id] },
			`call-${calls}`,
		);
	});
	try {
		id = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Keep",
			content: "fact",
		}).id;
		const response = await f.service.sendMessage({
			humanText: "Delete this memory",
		});
		expect(calls).toBe(6);
		expect(response.reason).toBe("budget");
		expect(response.approvals).toHaveLength(1);
		expect(f.service.listApprovals()).toHaveLength(1);
		expect(f.memory.runtime.memory.get(id).status).toBe("active");
	} finally {
		await f.dispose();
	}
});
test("same concurrent human request shares one model call and creates one persisted turn", async () => {
	let finish: (response: Response) => void = () => {},
		calls = 0;
	const f = butlerFixture(async () => {
		calls++;
		return new Promise<Response>((resolve) => {
			finish = resolve;
		});
	});
	try {
		const first = f.service.sendMessage({
			humanText: "hello",
			requestId: "concurrent",
		});
		const second = f.service.sendMessage({
			humanText: "hello",
			requestId: "concurrent",
		});
		finish(modelReply("hello back"));
		expect(await first).toEqual(await second);
		expect(calls).toBe(1);
		expect(f.service.listThreads()).toHaveLength(1);
	} finally {
		await f.dispose();
	}
});
test("shutdown drains a claimed approval before releasing its database and refuses new decisions", async () => {
	const f = butlerFixture();
	try {
		const t = await turn(f),
			memory = f.memory.runtime.memory.put({
				scopeKind: "global",
				title: "Fact",
				content: "durable fact",
			});
		const card = f.service.createApproval(
			{ actionType: "deleteMemoryBatch", memoryIds: [memory.id] },
			t,
		);
		const execute = f.tools.execute.bind(f.tools);
		let release = () => {};
		f.tools.execute = async (action) =>
			new Promise((resolve) => {
				release = () => {
					void execute(action).then(resolve);
				};
			});
		const decision = f.service.resolveApproval({
			approvalId: card.id,
			payloadHash: card.payloadHash,
			decision: "approve",
		});
		let disposed = false;
		const shutdown = f.service.dispose().then(() => {
			disposed = true;
		});
		await Promise.resolve();
		expect(disposed).toBe(false);
		release();
		expect((await decision).status).toBe("executed");
		await shutdown;
		expect(disposed).toBe(true);
		expect(() =>
			f.service.resolveApproval({
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve",
			}),
		).toThrow("closed");
	} finally {
		await f.dispose();
	}
});

const genericApprovalError =
	"Action did not complete; inspect target before requesting another approval";
for (const { name, error, expected } of [
	{
		name: "dirty guard without its stack or cause",
		error: new TRPCError({
			code: "CONFLICT",
			message: "Worktree has uncommitted changes\n    at private-internal-path",
			cause: new Error("private credential detail"),
		}),
		expected: "Worktree has uncommitted changes",
	},
	{
		name: "bounded public guard",
		error: new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Guard reason ".repeat(40),
		}),
		expected: "Guard reason ".repeat(40).trim().slice(0, 300),
	},
	{
		name: "internal TRPC failure",
		error: new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "private backend credential detail",
		}),
		expected: genericApprovalError,
	},
	{
		name: "unknown exception",
		error: new Error("private backend credential detail"),
		expected: genericApprovalError,
	},
	{
		name: "untrusted error-shaped object",
		error: { code: "CONFLICT", message: "private backend credential detail" },
		expected: genericApprovalError,
	},
	{
		name: "credential-shaped public guard",
		error: new TRPCError({
			code: "FORBIDDEN",
			message: "Upstream rejected Bearer isolated-test-token",
		}),
		expected: genericApprovalError,
	},
]) {
	test(`approval failure reports ${name} and cannot execute again`, async () => {
		const f = butlerFixture();
		try {
			const memory = f.memory.runtime.memory.put({
				scopeKind: "global",
				title: "Keep",
				content: "Retain until an action actually succeeds",
			});
			const card = f.service.requestApproval({
				requestId: "guarded-failure",
				humanText: "Retire only after confirmation",
				action: { actionType: "deleteMemoryBatch", memoryIds: [memory.id] },
			});
			let calls = 0;
			f.tools.execute = async () => {
				calls++;
				throw error;
			};
			const resolution = {
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve" as const,
			};
			const result = await f.service.resolveApproval(resolution);
			expect(result.status).toBe("failed");
			expect(result.error).toBe(expected);
			expect(result.error?.length).toBeLessThanOrEqual(300);
			expect(result.error).not.toMatch(/[\r\n\u2028\u2029]/u);
			expect(f.service.listApprovals({ status: "history" })[0]?.error).toBe(
				expected,
			);
			await expect(f.service.resolveApproval(resolution)).rejects.toMatchObject(
				{
					code: "CONFLICT",
				},
			);
			expect(calls).toBe(1);
			expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
		} finally {
			await f.dispose();
		}
	});
}
