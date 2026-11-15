import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatRuntime } from "@jedv/chat-runtime";
import {
	agentMessage,
	approvalRequest,
	createBunChatDb,
	fakeHarnessRegistry,
	turn,
} from "@jedv/chat-runtime/testing";
import { workspaces } from "../db/schema";
import { sessionsRouter } from "../trpc/router/sessions";
import type { HostServiceContext } from "../types";
import { executeChatPrompt } from "./execute";
import type { RunUpdate } from "./schema";
import { createAutomationTestHost } from "./test-host";

const drain = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("Kimi-style empty launch waits for protocol readiness then observes a real turn", async () => {
	const home = mkdtempSync(join(tmpdir(), "jedv-automation-protocol-"));
	let ready!: () => void;
	const gate = new Promise<void>((resolve) => {
		ready = resolve;
	});
	const { harnesses, adapters } = fakeHarnessRegistry({
		start: [
			{
				kind: "session",
				session: { status: "idle", harnessSessionId: "native-session-1" },
			},
		],
		turns: [
			[
				{ kind: "turn", turn: turn("turn-1") },
				{
					kind: "item",
					turnId: "turn-1",
					item: agentMessage("answer", "Completed review"),
				},
				{ kind: "turn", turn: turn("turn-1", { status: "completed" }) },
			],
		],
	});
	const factory = harnesses.get("fake");
	if (!factory) throw new Error("Fixture harness missing");
	harnesses.set("kimi-acp", (options) => {
		const adapter = factory(options);
		const start = adapter.start.bind(adapter);
		adapter.start = (options) =>
			(async function* () {
				await gate;
				yield* start(options);
			})();
		return adapter;
	});
	const runtime = createChatRuntime({
		dataDir: home,
		openDatabase: createBunChatDb,
		harnesses,
	});
	try {
		const created = runtime.commands.createSession({
			commandId: randomUUID(),
			scopeId: "workspace-1",
			harness: "kimi-acp",
			cwd: home,
			terminalId: "terminal-1",
		});
		const updates: RunUpdate[] = [];
		const work = executeChatPrompt({
			chat: runtime,
			sessionId: created.sessionId,
			prompt: "Review",
			runId: randomUUID(),
			update: (patch) => updates.push(patch),
			signal: new AbortController().signal,
		});
		await drain();
		expect(adapters[0]?.prompted).toHaveLength(0);
		ready();
		await work;
		expect(adapters[0]?.prompted).toEqual([[{ type: "text", text: "Review" }]]);
		expect(updates).toContainEqual({ nativeSessionId: "native-session-1" });
		expect(updates).toContainEqual({ status: "running" });
	} finally {
		await runtime.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});

test("launching an idle protocol session is not task completion and abort unsubscribes", async () => {
	const home = mkdtempSync(join(tmpdir(), "jedv-automation-abort-"));
	const { harnesses, adapters } = fakeHarnessRegistry({ start: [], turns: [] });
	const runtime = createChatRuntime({
		dataDir: home,
		openDatabase: createBunChatDb,
		harnesses,
	});
	try {
		const { sessionId } = runtime.commands.createSession({
			commandId: randomUUID(),
			scopeId: "workspace-1",
			harness: "fake",
			cwd: home,
		});
		const controller = new AbortController();
		const work = executeChatPrompt({
			chat: runtime,
			sessionId,
			prompt: "Do not send",
			runId: randomUUID(),
			update: () => {},
			signal: controller.signal,
		});
		let completed = false;
		void work.then(
			() => {
				completed = true;
			},
			() => {},
		);
		await drain();
		expect(completed).toBe(false);
		expect(adapters[0]?.prompted).toHaveLength(0);
		controller.abort();
		await expect(work).rejects.toThrow("stopped before completion");
		expect(runtime.subscriptions.subscriberCount(sessionId)).toBe(0);
	} finally {
		await runtime.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});

for (const interrupt of [false, true])
	test(
		interrupt
			? "existing session interrupt cancels the real automation turn"
			: "existing session approval control releases the blocked automation turn",
		async () => {
			const home = mkdtempSync(join(tmpdir(), "jedv-automation-controls-"));
			const { harnesses } = fakeHarnessRegistry({
				start: [
					{
						kind: "session",
						session: { status: "idle", harnessSessionId: "native-controls" },
					},
				],
				turns: [
					[
						{ kind: "turn", turn: turn("controlled-turn") },
						{
							kind: "item",
							turnId: "controlled-turn",
							item: approvalRequest("approval-1"),
						},
						{
							kind: "item",
							turnId: "controlled-turn",
							item: agentMessage("answer", "Approved review"),
						},
						{
							kind: "turn",
							turn: turn("controlled-turn", { status: "completed" }),
						},
					],
				],
			});
			const factory = harnesses.get("fake");
			if (!factory) throw new Error("Fixture harness missing");
			harnesses.set("kimi-acp", factory);
			const runtime = createChatRuntime({
				dataDir: home,
				openDatabase: createBunChatDb,
				harnesses,
			});
			const host = createAutomationTestHost(home);
			try {
				const workspaceId = randomUUID();
				host.db
					.insert(workspaces)
					.values({
						id: workspaceId,
						projectId: null,
						type: "session",
						worktreePath: home,
						branch: "",
						name: "automation controls",
					})
					.run();
				const caller = sessionsRouter.createCaller({
					db: host.db,
					runtime: { chat: () => runtime },
					isAuthenticated: true,
				} as unknown as HostServiceContext);
				const { sessionId } = runtime.commands.createSession({
					commandId: randomUUID(),
					scopeId: workspaceId,
					harness: "kimi-acp",
					cwd: home,
				});
				const updates: RunUpdate[] = [];
				const work = executeChatPrompt({
					chat: runtime,
					sessionId,
					prompt: "Review",
					runId: randomUUID(),
					update: (patch) => updates.push(patch),
					signal: new AbortController().signal,
				});
				void work.catch(() => {});
				await drain();
				expect(updates).toContainEqual({ status: "awaiting-approval" });
				expect(
					JSON.stringify(await caller.read({ workspaceId, sessionId })),
				).toContain("approval-1");
				if (interrupt) {
					await caller.interrupt({
						workspaceId,
						sessionId,
						turnId: "controlled-turn",
					});
					await expect(work).rejects.toMatchObject({ name: "AbortError" });
				} else {
					await caller.respondApproval({
						workspaceId,
						sessionId,
						itemId: "approval-1",
						decision: { type: "accept" },
					});
					await work;
					expect(updates).toContainEqual({ status: "running" });
				}
			} finally {
				await runtime.dispose();
				await host.dispose();
				rmSync(home, { recursive: true, force: true });
			}
		},
	);
