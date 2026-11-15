import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	assertNativeBindingIdle,
	nativeBindingTurnState,
	nativeControlProjection,
} from "./nativeControl";

test("native claim uses Agent lifecycle events and refuses busy, approval and unknown CLI bindings", () => {
	for (const event of [
		"Start",
		"PermissionRequest",
		"Attached",
		"unrecognized",
	]) {
		expect(() => assertNativeBindingIdle({ lastEventType: event })).toThrow(
			"busy or its lifecycle is unknown",
		);
	}
	for (const event of ["Stop", "Failed"]) {
		expect(nativeBindingTurnState({ lastEventType: event })).toBe("idle");
		expect(() =>
			assertNativeBindingIdle({ lastEventType: event }),
		).not.toThrow();
	}
	expect(nativeBindingTurnState({ lastEventType: "Start", endedAt: 1 })).toBe(
		"idle",
	);
	expect(() => assertNativeBindingIdle(null)).toThrow();
});

test("native history reuses the bounded control journal and its cursor without claiming CLI coverage", () => {
	type Commands = NonNullable<Parameters<typeof nativeControlProjection>[0]>;
	const session = { session: { sessionId: "projection" } } as ReturnType<
		Commands["getSession"]
	>;
	const items = {
		ok: true as const,
		envelopes: [],
		nextBefore: { epoch: "epoch", seq: 4 },
	};
	const reads: unknown[] = [];
	const commands: Commands = {
		getSession(input) {
			reads.push(input);
			return session;
		},
		getItems(input) {
			reads.push(input);
			return items;
		},
	};
	const result = nativeControlProjection(commands, "projection", "epoch:8");
	expect(result).toEqual({
		source: "control-projection",
		coverage: "control-projection",
		chatSessionId: "projection",
		session,
		items,
		nextCursor: "epoch:4",
	});
	expect(reads).toEqual([
		{ sessionId: "projection" },
		{ sessionId: "projection", limit: 100, before: { epoch: "epoch", seq: 8 } },
	]);
	expect(() => nativeControlProjection(commands, null)).toThrow(
		"Acquire Control first",
	);
	expect(() =>
		nativeControlProjection(commands, "projection", "invalid"),
	).toThrow("Invalid projection cursor");
});

test("querying a live Chat bridge binding never claims CLI or blocks its prompt and approval", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { createChatRuntime } = await import("@jedv/chat-runtime");
	const {
		createBunChatDb,
		fakeHarnessRegistry,
		turn,
		approvalRequest,
		agentMessage,
	} = await import("@jedv/chat-runtime/testing");
	const { createAutomationTestHost } = await import(
		"../../../automations/test-host"
	);
	const { createChatAgentBridge } = await import(
		"../../../chat-v3/chatAgentBridge"
	);
	const { sessionControlBrokerFor } = await import(
		"../../../chat-v3/sessionControlBroker"
	);
	const { TerminalAgentStore } = await import("../../../terminal-agents");
	const { router } = await import("../../index");
	const { nativeControlProcedures } = await import("./nativeControl");
	type Context = import("../../../types").HostServiceContext;
	const home = mkdtempSync(join(tmpdir(), "jedv-native-chat-query-"));
	const host = createAutomationTestHost(home);
	let runtime: ReturnType<typeof createChatRuntime>;
	const store = new TerminalAgentStore();
	const ctx = {
		db: host.db,
		terminalAgentStore: store,
		isAuthenticated: true,
		runtime: { chat: () => runtime },
		eventBus: {
			broadcastAgentLifecycle: () => {},
			broadcastAgentBindingsChanged: () => {},
			broadcastWorkspaceChanged: () => {},
		},
	} as unknown as Context;
	const bridge = createChatAgentBridge(ctx);
	const broker = sessionControlBrokerFor(host.db);
	const { harnesses } = fakeHarnessRegistry({
		start: [
			{
				kind: "session",
				session: { status: "idle", harnessSessionId: "native-query-safe" },
			},
		],
		turns: [
			[
				{ kind: "turn", turn: turn("query-safe-turn") },
				{ kind: "session", session: { status: "awaiting_input" } },
				{
					kind: "item",
					turnId: "query-safe-turn",
					item: approvalRequest("query-safe-approval"),
				},
				{
					kind: "item",
					turnId: "query-safe-turn",
					item: agentMessage("answer", "done"),
				},
				{
					kind: "turn",
					turn: turn("query-safe-turn", { status: "completed" }),
				},
			],
		],
	});
	const factory = harnesses.get("fake");
	if (!factory) throw new Error("Missing fixture");
	harnesses.set("kimi-acp", (options) =>
		broker.guardHarnessAdapter(
			factory(options),
			options.scopeId,
			options.sessionId,
		),
	);
	runtime = createChatRuntime({
		dataDir: home,
		openDatabase: createBunChatDb,
		harnesses,
		observer: bridge,
	});
	const flush = async () => {
		for (let i = 0; i < 30; i++) await Promise.resolve();
	};
	try {
		const { sessionId } = runtime.commands.createSession({
			commandId: randomUUID(),
			scopeId: "workspace",
			cwd: home,
			harness: "kimi-acp",
			terminalId: "virtual-terminal",
		});
		await flush();
		const caller = router(nativeControlProcedures).createCaller(ctx);
		const queried = await caller.queryNativeSession({
			workspaceId: "workspace",
			provider: "kimi",
			terminalId: "virtual-terminal",
			nativeSessionId: "native-query-safe",
		});
		expect(queried).toMatchObject({
			source: "chat-session",
			terminalId: null,
			chatSessionId: sessionId,
			activeWriter: "control",
			supported: false,
		});
		runtime.commands.prompt({
			commandId: randomUUID(),
			sessionId,
			clientId: "automation",
			content: [{ type: "text", text: "work" }],
		});
		await flush();
		expect(
			(
				await caller.queryNativeSession({
					workspaceId: "workspace",
					provider: "kimi",
					terminalId: "virtual-terminal",
					nativeSessionId: "native-query-safe",
				})
			).terminalId,
		).toBeNull();
		expect(runtime.live.require(sessionId).turn?.status).toBe("running");
		runtime.commands.respondToApproval({
			commandId: randomUUID(),
			sessionId,
			approvalId: "query-safe-approval",
			decision: { type: "accept" },
		});
		await flush();
		expect(runtime.live.require(sessionId).turn?.status).toBe("completed");
	} finally {
		await runtime.dispose();
		await host.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});

test("CLI and native Control resolve the same configured executable, env wrapper and resume argv", async () => {
	const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const { createAutomationTestHost } = await import(
		"../../../automations/test-host"
	);
	const { hostAgentConfigs, workspaces } = await import("../../../db/schema");
	const { resolveHarnessCli } = await import("../../../chat-v3/mount");
	const { resolveNativeLaunch, nativeResumeArgs } = await import(
		"./nativeControl"
	);
	type Context = import("../../../types").HostServiceContext;
	const home = mkdtempSync(join(tmpdir(), "jedv-native-config-"));
	const program = join(home, "custom agent");
	writeFileSync(
		program,
		`#!${process.execPath}\nif(process.argv.includes('--version'))console.log('kimi 2.6.2');else console.log(JSON.stringify({args:process.argv.slice(2),TZ:process.env.TZ,LANG:process.env.LANG,AMBIENT:process.env.AMBIENT,PROFILE:process.env.PROFILE}));\n`,
		{ mode: 0o755 },
	);
	const host = createAutomationTestHost(home);
	try {
		const workspaceId = randomUUID();
		const configId = randomUUID();
		host.db
			.insert(workspaces)
			.values({
				id: workspaceId,
				projectId: null,
				worktreePath: home,
				branch: "",
				name: "launch config",
				type: "session",
			})
			.run();
		host.db
			.insert(hostAgentConfigs)
			.values({
				id: configId,
				presetId: "kimi",
				label: "custom Kimi",
				command: "/usr/bin/env",
				argsJson: JSON.stringify([
					"TZ=Asia/Shanghai",
					"LANG=zh_CN.UTF-8",
					program,
					"--yolo",
				]),
				envJson: JSON.stringify({ TZ: "UTC", PROFILE: "configured" }),
				resumeArgsJson: JSON.stringify(["--session", "--keep-model"]),
				promptTransport: "argv",
				displayOrder: 0,
			})
			.run();
		const env = async () => ({ PATH: process.env.PATH, AMBIENT: "kept" });
		const cli = await resolveNativeLaunch(
			{ db: host.db } as Context,
			{ workspaceId, provider: "kimi", agentConfigId: configId },
			env,
		);
		const control = await resolveHarnessCli(
			host.db,
			{
				sessionId: "projection",
				scopeId: workspaceId,
				cwd: home,
				harness: "kimi-acp",
				agentConfigId: configId,
			},
			"kimi",
			"kimi-acp",
			env,
		);
		expect(control.command).toBe(program);
		expect(control.command).toBe(cli.command);
		expect(control.env).toEqual(cli.env);
		expect(control.configurationKey).toBe(cli.configurationKey);
		expect(control.controlArgs).toEqual(["--yolo"]);
		const args = [
			...cli.baseArgs,
			...nativeResumeArgs("kimi", cli.resumeArgs, "original-native-id"),
		];
		const { stdout } = await promisify(execFile)(cli.command, args, {
			cwd: home,
			env: cli.env,
		});
		expect(JSON.parse(stdout)).toEqual({
			args: ["--yolo", "--session", "--keep-model", "original-native-id"],
			TZ: "Asia/Shanghai",
			LANG: "zh_CN.UTF-8",
			AMBIENT: "kept",
			PROFILE: "configured",
		});
	} finally {
		await host.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});

test("native resume preserves configured args and Codex shared remote with the exact original ID", async () => {
	const { nativeResumeArgs } = await import("./nativeControl");
	expect(
		nativeResumeArgs("claude", ["--resume", "--verbose"], "original"),
	).toEqual(["--resume", "--verbose", "original"]);
	expect(nativeResumeArgs("agy", ["--conversation"], "original")).toEqual([
		"--conversation",
		"original",
	]);
	expect(
		nativeResumeArgs(
			"codex",
			["resume", "--all"],
			"original",
			"unix:///shared.sock",
		),
	).toEqual(["resume", "--all", "--remote", "unix:///shared.sock", "original"]);
	expect(() =>
		nativeResumeArgs(
			"codex",
			["resume", "--last"],
			"original",
			"unix:///shared.sock",
		),
	).toThrow("preserve");
	expect(() => nativeResumeArgs("kimi", [], "original")).toThrow(
		"no id-based resume",
	);
});

test("unsupported env flags and shell syntax stay intact on the existing CLI fallback", async () => {
	const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const { createAutomationTestHost } = await import(
		"../../../automations/test-host"
	);
	const { hostAgentConfigs } = await import("../../../db/schema");
	const { nativeCommandSpec, nativeControlArgs } = await import(
		"../../../chat-v3/agentCli"
	);
	const { buildTerminalAgentLaunch } = await import("../agents/agents");
	const home = mkdtempSync(join(tmpdir(), "jedv-native-cli-only-"));
	const program = join(home, "fake-cli");
	writeFileSync(
		program,
		`#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),REMOVED:process.env.REMOVED??null}));\n`,
		{ mode: 0o755 },
	);
	const host = createAutomationTestHost(home);
	try {
		const config = {
			command: "env",
			args: ["-u", "REMOVED", program, "literal value"],
			env: { REMOVED: "remove-me" },
			resumeArgs: [],
		};
		expect(() => nativeCommandSpec(config)).toThrow("env flags");
		expect(() =>
			nativeCommandSpec({
				...config,
				command: "mise",
				args: ["exec", "--", "kimi"],
			}),
		).toThrow("wrapper");
		expect(() =>
			nativeCommandSpec({ ...config, command: "printf hi && kimi", args: [] }),
		).toThrow("Shell command syntax");
		expect(() => nativeControlArgs("claude", ["--custom-unknown"])).toThrow(
			"CLI-only",
		);
		const id = randomUUID();
		host.db
			.insert(hostAgentConfigs)
			.values({
				id,
				presetId: "kimi",
				label: "CLI only",
				command: config.command,
				argsJson: JSON.stringify(config.args),
				envJson: JSON.stringify(config.env),
				resumeArgsJson: "[]",
				promptTransport: "argv",
				displayOrder: 0,
			})
			.run();
		const { fullCommand } = buildTerminalAgentLaunch(host.db, {
			workspaceId: "fixture",
			agent: id,
			prompt: "",
			surface: "terminal",
		});
		const { stdout } = await promisify(execFile)(
			"/bin/sh",
			["-c", fullCommand],
			{ cwd: home, env: process.env },
		);
		expect(JSON.parse(stdout)).toEqual({
			args: ["literal value"],
			REMOVED: null,
		});
	} finally {
		await host.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});

test("Codex service argv excludes TUI flags and changed active configuration is rejected", async () => {
	const { nativeControlArgs } = await import("../../../chat-v3/agentCli");
	const { assertCodexDaemonConfiguration, nativeProfileHash } = await import(
		"../../../chat-v3/codexDaemon"
	);
	expect(
		nativeControlArgs("codex", [
			"--dangerously-bypass-approvals-and-sandbox",
			"--dangerously-bypass-hook-trust",
			"-c",
			"model=example",
			"--enable=feature",
		]),
	).toEqual(["-c", "model=example", "--enable=feature"]);
	expect(() => nativeControlArgs("codex", ["resume", "--last"])).toThrow(
		"not compatible",
	);
	expect(() => assertCodexDaemonConfiguration("old", "new")).toThrow(
		"existing daemon and native session were preserved",
	);
	expect(() => assertCodexDaemonConfiguration("same", "same")).not.toThrow();
	expect(
		nativeProfileHash("codex", { CODEX_HOME: "/same/profile", TZ: "UTC" }),
	).toBe(
		nativeProfileHash("codex", {
			CODEX_HOME: "/same/profile",
			TZ: "Asia/Shanghai",
		}),
	);
});
