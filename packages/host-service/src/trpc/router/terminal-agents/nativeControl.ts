import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCursor, serializeCursor } from "@jedv/chat/protocol";
import type { ChatRuntime } from "@jedv/chat-runtime";
import { hasRunningForegroundProcess } from "@jedv/pty-daemon/process-tree";
import { agentStatusFromEvent } from "@jedv/shared/agent-status";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
	NativeCliOnlyError,
	nativeControlArgs,
	resolveConfiguredAgentCli,
} from "../../../chat-v3/agentCli";
import { buildChatAgentEnv } from "../../../chat-v3/agentEnv";
import { nativeProfileHash } from "../../../chat-v3/codexDaemon";
import { createResolveCwd } from "../../../chat-v3/resolveCwd";
import {
	controlCapabilities,
	type NativeIdentity,
	type NativeProvider,
	sessionControlBrokerFor,
} from "../../../chat-v3/sessionControlBroker";
import type { HostDb } from "../../../db";
import { terminalAgentBindings } from "../../../db/schema";
import { getDaemonClient } from "../../../terminal/daemon-client-singleton";
import {
	createTerminalSessionInternal,
	disposeSessionAndWait,
} from "../../../terminal/terminal";
import { resolveHostAgentConfig } from "../../../terminal-agents/agent-config";
import { getTerminalAgentBinding } from "../../../terminal-agents/persistence";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure } from "../../index";
import { chatLaunchPresetId, runAgentInWorkspace } from "../agents/agents";
import { seedDefaultsIfEmpty } from "../settings/agent-configs";

const provider = z.enum(["codex", "claude", "agy", "kimi"]);
const base = z.object({
	workspaceId: z.string().min(1),
	provider,
	agentConfigId: z.string().optional(),
});
const identified = base.extend({ nativeSessionId: z.string().min(1) });
const leased = identified.extend({
	expectedLeaseEpoch: z.number().int().nonnegative(),
});
type Input = z.infer<typeof base> & {
	nativeSessionId?: string;
	terminalId?: string;
};
const harnessFor = (provider: NativeProvider) =>
	provider === "claude"
		? "claude-code"
		: provider === "codex"
			? "codex"
			: `${provider}-acp`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function nativeControlProjection(
	commands:
		| Pick<ChatRuntime["commands"], "getSession" | "getItems">
		| undefined,
	chatSessionId: string | null,
	cursor?: string,
) {
	const session =
		commands && chatSessionId
			? commands.getSession({ sessionId: chatSessionId })
			: null;
	if (!commands || !chatSessionId || !session?.session)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Acquire Control first to load this session's journal projection",
		});
	let before: ReturnType<typeof parseCursor> | undefined;
	try {
		before = cursor ? parseCursor(cursor) : undefined;
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid projection cursor",
		});
	}
	const items = commands.getItems({
		sessionId: chatSessionId,
		limit: 100,
		before,
	});
	return {
		source: "control-projection" as const,
		coverage: "control-projection" as const,
		chatSessionId,
		session,
		items,
		nextCursor:
			items.ok && items.nextBefore ? serializeCursor(items.nextBefore) : null,
	};
}

export function nativeBindingTurnState(
	binding:
		| { lastEventType: string; endedAt?: number | null }
		| null
		| undefined,
) {
	if (!binding) return "unknown" as const;
	if (binding.endedAt) return "idle" as const;
	switch (agentStatusFromEvent(binding.lastEventType)) {
		case "working":
			return "running" as const;
		case "permission":
			return "awaiting-approval" as const;
		case "review":
		case "failed":
			return "idle" as const;
		default:
			return "unknown" as const;
	}
}

export function assertNativeBindingIdle(
	binding: Parameters<typeof nativeBindingTurnState>[0],
): void {
	if (nativeBindingTurnState(binding) !== "idle")
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Native agent is busy or its lifecycle is unknown; finish its work before closing CLI for Control",
		});
}

export function nativeChatProjection(
	ctx: Pick<HostServiceContext, "runtime" | "terminalAgentStore">,
	input: Input,
) {
	const binding = input.terminalId
		? ctx.terminalAgentStore.getChat(input.terminalId)
		: ctx.terminalAgentStore
				.list()
				.find(
					(entry) =>
						entry.chatSessionId &&
						entry.workspaceId === input.workspaceId &&
						entry.agentId === input.provider &&
						entry.agentSessionId === input.nativeSessionId,
				);
	if (!binding?.chatSessionId) return null;
	if (
		binding.workspaceId !== input.workspaceId ||
		binding.agentId !== input.provider
	)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Chat binding does not match workspace/provider",
		});
	const live = ctx.runtime.chat?.().live.get(binding.chatSessionId);
	if (!live) return null;
	if (
		input.nativeSessionId &&
		live.state.harnessSessionId !== input.nativeSessionId
	)
		throw new TRPCError({
			code: "CONFLICT",
			message: "Chat now runs another native session",
		});
	return {
		source: "chat-session" as const,
		supported: false,
		controlMode: "unsupported" as const,
		reason:
			"This is an existing Chat session. Read, approve and interrupt it through sessions APIs; it has no CLI PTY.",
		verification: "existing-chat-session",
		workspaceId: input.workspaceId,
		provider: input.provider,
		nativeSessionId: live.state.harnessSessionId ?? null,
		profileHash: null,
		cwd: null,
		terminalId: null,
		chatSessionId: binding.chatSessionId,
		activeWriter: "control" as const,
		leaseEpoch: 0,
		turnState:
			binding.lastEventType === "PermissionRequest" ||
			live.state.status === "awaiting_input"
				? ("awaiting-approval" as const)
				: live.busy
					? ("running" as const)
					: ("idle" as const),
		turnId: live.turn?.id ?? null,
		pendingApprovals: [],
	};
}

export async function resolveNativeLaunch(
	ctx: HostServiceContext,
	input: Input,
	envOverride?: () => Promise<NodeJS.ProcessEnv>,
) {
	seedDefaultsIfEmpty(ctx.db);
	const cwd = createResolveCwd(ctx.db)(input.workspaceId);
	const config = resolveHostAgentConfig(
		ctx.db,
		input.agentConfigId ?? input.provider,
	);
	if (input.agentConfigId) {
		if (
			!config ||
			(config.presetId !== input.provider &&
				chatLaunchPresetId(config) !== input.provider)
		)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Agent config does not match the selected native provider",
			});
	}
	if (!config)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Agent configuration is unavailable",
		});
	const cli = await resolveConfiguredAgentCli({
		provider: input.provider,
		config,
		cwd,
		minVersion: input.provider === "codex" ? "0.169.0" : "0.0.0",
		env:
			envOverride ??
			(() =>
				buildChatAgentEnv({
					db: ctx.db,
					cwd,
					workspaceId: input.workspaceId,
					agentConfigId: input.agentConfigId ?? config?.id,
					presetId: input.provider,
				})),
	});
	return {
		...cli,
		cwd,
		profileHash: nativeProfileHash(input.provider, cli.env),
		serverArgs: nativeControlArgs(input.provider, cli.baseArgs),
		controlModeId:
			input.provider === "claude"
				? cli.baseArgs.includes("--dangerously-skip-permissions")
					? "bypassPermissions"
					: "default"
				: undefined,
		agentConfigId: input.agentConfigId ?? config?.id,
	};
}

export async function nativeCliRunning(
	ctx: Pick<HostServiceContext, "db">,
	workspaceId: string,
	terminalId: string | null,
): Promise<boolean> {
	if (!terminalId) return false;
	const binding = getTerminalAgentBinding(ctx.db, terminalId);
	if (binding && binding.workspaceId !== workspaceId)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Terminal belongs to another workspace",
		});
	const daemon = await getDaemonClient();
	const terminal = (await daemon.list()).find(
		(entry) => entry.id === terminalId,
	);
	if (!terminal?.alive) return false;
	if (binding?.endedAt) return false;
	if (!binding) return true;
	if (binding.lastEventType === "Attached") return true;
	return hasRunningForegroundProcess(terminal.pid);
}

export async function assertNativeCliReleased(
	db: HostDb,
	workspaceId: string,
	nativeSessionId: string,
): Promise<void> {
	const bindings = db
		.select({
			terminalId: terminalAgentBindings.terminalId,
			endedAt: terminalAgentBindings.endedAt,
		})
		.from(terminalAgentBindings)
		.where(
			and(
				eq(terminalAgentBindings.workspaceId, workspaceId),
				eq(terminalAgentBindings.agentSessionId, nativeSessionId),
			),
		)
		.all();
	for (const binding of bindings)
		if (
			!binding.endedAt &&
			(await nativeCliRunning({ db }, workspaceId, binding.terminalId))
		)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Native CLI is still running; exit it before loading Control",
			});
}

export function nativeResumeArgs(
	provider: NativeProvider,
	resumeArgs: string[],
	nativeSessionId?: string,
	remote?: string,
): string[] {
	if (!nativeSessionId)
		return provider === "codex" && remote ? ["--remote", remote] : [];
	if (resumeArgs.length === 0)
		throw new NativeCliOnlyError(
			"This agent config has no id-based resume arguments; use CLI-only launch",
		);
	if (provider === "codex") {
		if (
			resumeArgs[0] !== "resume" ||
			resumeArgs.some(
				(arg) =>
					arg === "--last" || arg === "--remote" || arg.startsWith("--remote="),
			) ||
			!remote
		)
			throw new NativeCliOnlyError(
				"Configured Codex resume arguments cannot preserve the shared server and exact session ID; use CLI-only launch",
			);
		return [...resumeArgs, "--remote", remote, nativeSessionId];
	}
	return [...resumeArgs, nativeSessionId];
}
function cliOnlyProjection(
	ctx: HostServiceContext,
	input: Input,
	reason: string,
	terminalId: string | null = input.terminalId ?? null,
) {
	return {
		source: "cli-only" as const,
		supported: false,
		controlMode: "unsupported" as const,
		verification: "configured-cli-fallback",
		reason,
		workspaceId: input.workspaceId,
		provider: input.provider,
		cwd: createResolveCwd(ctx.db)(input.workspaceId),
		profileHash: null,
		nativeSessionId: null,
		terminalId,
		chatSessionId: null,
		activeWriter: terminalId ? ("cli" as const) : ("none" as const),
		leaseEpoch: 0,
		turnState: "unknown" as const,
		turnId: null,
		pendingApprovals: [],
	};
}
async function launchConfiguredCliOnly(
	ctx: HostServiceContext,
	input: Input,
	reason: string,
) {
	const config = resolveHostAgentConfig(
		ctx.db,
		input.agentConfigId ?? input.provider,
	);
	if (!config)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Agent configuration is unavailable",
		});
	const launched = await runAgentInWorkspace(ctx, {
		workspaceId: input.workspaceId,
		agent: config.id,
		prompt: "",
		surface: "terminal",
		resumeSessionId: input.nativeSessionId,
	});
	return cliOnlyProjection(ctx, input, reason, launched.sessionId);
}

async function spawnCli(
	ctx: HostServiceContext,
	input: Input,
	launch: Awaited<ReturnType<typeof resolveNativeLaunch>>,
	args: string[],
) {
	const terminalId = randomUUID();
	const dir = await mkdtemp(join(tmpdir(), "jedv-native-launch-"));
	const script = join(dir, "launch.cjs");
	const env = { ...launch.env, JEDV_TERMINAL_ID: terminalId };
	await writeFile(
		script,
		`const {spawn}=require('node:child_process');const {rm}=require('node:fs/promises');const config=${JSON.stringify({ command: launch.command, args: [...launch.baseArgs, ...args], cwd: launch.cwd, env })};rm(${JSON.stringify(dir)},{recursive:true,force:true}).then(()=>{const child=spawn(config.command,config.args,{cwd:config.cwd,env:config.env,stdio:'inherit'});child.on('error',()=>process.exit(1));child.on('exit',(code)=>process.exit(code??1));}).catch(()=>process.exit(1));`,
		{ mode: 0o600 },
	);
	try {
		const created = await createTerminalSessionInternal({
			terminalId,
			workspaceId: input.workspaceId,
			cwd: launch.cwd,
			db: ctx.db,
			eventBus: ctx.eventBus,
			initialCommand: `exec env ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(script)}`,
		});
		if ("error" in created)
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: created.error,
			});
		if (input.nativeSessionId)
			ctx.terminalAgentStore.recordEvent({
				terminalId,
				workspaceId: input.workspaceId,
				agentId: input.provider,
				agentSessionId: input.nativeSessionId,
				eventType: "Attached",
				occurredAt: Date.now(),
			});
		return terminalId;
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}

async function ensure(ctx: HostServiceContext, input: Input) {
	if (nativeChatProjection(ctx, input))
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"This session is already owned by Chat; use sessions APIs without launching another CLI",
		});
	const launch = await resolveNativeLaunch(ctx, input);
	const broker = sessionControlBrokerFor(ctx.db);
	let binding = input.terminalId
		? getTerminalAgentBinding(ctx.db, input.terminalId)
		: ctx.terminalAgentStore
				.list()
				.find(
					(entry) =>
						entry.workspaceId === input.workspaceId &&
						entry.agentId === input.provider &&
						entry.agentSessionId === input.nativeSessionId,
				);
	if (
		binding &&
		(binding.workspaceId !== input.workspaceId ||
			binding.agentId !== input.provider)
	)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Native binding does not match workspace/provider",
		});
	const nativeSessionId = input.nativeSessionId ?? binding?.agentSessionId;
	if (!nativeSessionId) return { launch, broker, identity: null, binding };
	if (
		binding?.agentSessionId &&
		input.nativeSessionId &&
		binding.agentSessionId !== input.nativeSessionId
	)
		throw new TRPCError({
			code: "CONFLICT",
			message: "Terminal now runs another native session",
		});
	const identity: NativeIdentity = {
		workspaceId: input.workspaceId,
		provider: input.provider,
		profileHash: launch.profileHash,
		nativeSessionId,
	};
	if (input.provider === "codex") {
		const daemon = await broker.daemons.ensure({
			...launch,
			args: launch.serverArgs,
			workspaceId: input.workspaceId,
		});
		const response = (await daemon.client.request("thread/resume", {
			threadId: nativeSessionId,
			excludeTurns: true,
		})) as {
			cwd?: string;
			thread: { id: string; cwd?: string; status?: { type: string } };
		};
		if (response.thread.id !== nativeSessionId)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Native session identity changed",
			});
		launch.cwd = response.cwd ?? response.thread.cwd ?? launch.cwd;
		broker.register(identity, launch.cwd, daemon, launch.configurationKey);
		broker.setTurnState(
			identity,
			response.thread.status?.type === "active"
				? "running"
				: response.thread.status?.type === "idle"
					? "idle"
					: "unknown",
		);
	} else {
		const previous = broker.register(
			identity,
			launch.cwd,
			undefined,
			launch.configurationKey,
		);
		if (!binding && previous.terminalId)
			binding =
				getTerminalAgentBinding(ctx.db, previous.terminalId) ?? undefined;
		if (previous.activeWriter !== "control")
			broker.setTurnState(identity, nativeBindingTurnState(binding));
	}
	const state = broker.state(identity);
	if (!state.terminalId && binding?.terminalId)
		broker.bindCli(identity, binding.terminalId);
	return { launch, broker, identity, binding };
}

function result(
	state: ReturnType<ReturnType<typeof sessionControlBrokerFor>["state"]>,
) {
	const capability = controlCapabilities().find(
		(item) => item.provider === state.provider,
	);
	return {
		source: "native-session" as const,
		...state,
		supported: capability?.supported ?? false,
		controlMode: capability?.controlMode ?? "unsupported",
		...("reason" in (capability ?? {})
			? { reason: (capability as { reason: string }).reason }
			: {}),
		verification:
			state.activeWriter === "control" ? "session-loaded" : "adapter-available",
	};
}

async function loadControl(
	ctx: HostServiceContext,
	input: z.infer<typeof identified>,
	cwd: string,
	profileHash: string,
	modeId?: string,
): Promise<string> {
	const runtime = ctx.runtime.chat?.();
	if (!runtime)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Chat runtime is unavailable",
		});
	const old = runtime.commands
		.listSessions({ scopeId: input.workspaceId, limit: 1000 })
		.find(
			(row) =>
				row.harness === harnessFor(input.provider) &&
				row.harnessSessionId === input.nativeSessionId &&
				row.live,
		);
	if (old) {
		if ((old.agentConfigId ?? null) !== (input.agentConfigId ?? null))
			throw new TRPCError({
				code: "CONFLICT",
				message:
					"An existing Control adapter uses another agent profile; close it before claiming this profile",
			});
		const live = runtime.live.require(old.sessionId);
		if (live.busy || live.queuedCount || live.state.backgroundTasks?.length)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Control agent is busy",
			});
		return old.sessionId;
	}
	const created = runtime.commands.createSession({
		commandId: randomUUID(),
		scopeId: input.workspaceId,
		harness: harnessFor(input.provider),
		cwd,
		agentConfigId: input.agentConfigId ?? null,
		...(modeId ? { modeId } : {}),
		resume: { harnessSessionId: input.nativeSessionId },
	});
	sessionControlBrokerFor(ctx.db).authorizeControlLoad(
		{
			workspaceId: input.workspaceId,
			provider: input.provider,
			nativeSessionId: input.nativeSessionId,
			profileHash,
		},
		created.sessionId,
	);
	try {
		const deadline = Date.now() + 3000;
		while (true) {
			const live = runtime.live.get(created.sessionId);
			if (!live || live.state.status === "dead")
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Native resume failed; check authentication and session ID",
				});
			if (live.state.status !== "starting") {
				if (live.state.harnessSessionId !== input.nativeSessionId)
					throw new TRPCError({
						code: "CONFLICT",
						message: "Native provider returned another session ID",
					});
				return created.sessionId;
			}
			if (Date.now() >= deadline)
				throw new TRPCError({
					code: "TIMEOUT",
					message: "Native resume is still starting; retry after it settles",
				});
			await new Promise((r) => setTimeout(r, 10));
		}
	} catch (error) {
		await runtime.live.dispose(created.sessionId);
		throw error;
	}
}

export const nativeControlProcedures = {
	controlCapabilities: protectedProcedure.query(() => controlCapabilities()),
	launchNativeSession: protectedProcedure
		.input(base.extend({ nativeSessionId: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			let ready: Awaited<ReturnType<typeof ensure>>;
			try {
				ready = await ensure(ctx, input);
			} catch (error) {
				if (error instanceof NativeCliOnlyError)
					return launchConfiguredCliOnly(ctx, input, error.message);
				throw error;
			}
			const { launch, broker, identity } = ready;
			let args: string[];
			try {
				const daemon =
					input.provider === "codex"
						? await broker.daemons.ensure({
								...launch,
								args: launch.serverArgs,
								workspaceId: input.workspaceId,
							})
						: null;
				args = nativeResumeArgs(
					input.provider,
					launch.resumeArgs,
					input.nativeSessionId,
					daemon ? `unix://${daemon.socketPath}` : undefined,
				);
			} catch (error) {
				if (error instanceof NativeCliOnlyError)
					return launchConfiguredCliOnly(ctx, input, error.message);
				throw error;
			}

			if (identity)
				return result(
					await broker.open(
						identity,
						broker.state(identity).leaseEpoch,
						async (state) => {
							if (
								state.terminalId &&
								(await nativeCliRunning(
									ctx,
									input.workspaceId,
									state.terminalId,
								))
							)
								return state.terminalId;
							if (state.chatSessionId) {
								const runtime = ctx.runtime.chat?.();
								const live = runtime?.live.get(state.chatSessionId);
								if (
									live &&
									(live.busy ||
										live.queuedCount ||
										live.state.backgroundTasks?.length)
								)
									throw new TRPCError({
										code: "CONFLICT",
										message: "Control agent is busy",
									});
								await runtime?.live.dispose(state.chatSessionId);
							}
							return spawnCli(ctx, input, launch, args);
						},
					),
				);
			const terminalId = await spawnCli(ctx, input, launch, args);
			const capability = controlCapabilities().find(
				(item) => item.provider === input.provider,
			);
			return {
				source: "native-session" as const,
				...capability,
				workspaceId: input.workspaceId,
				provider: input.provider,
				profileHash: launch.profileHash,
				nativeSessionId: null,
				cwd: launch.cwd,
				terminalId,
				chatSessionId: null,
				activeWriter: "cli" as const,
				leaseEpoch: 0,
				turnState: "unknown" as const,
				turnId: null,
				pendingApprovals: [],
				verification: "awaiting-native-hook",
			};
		}),
	queryNativeSession: protectedProcedure
		.input(
			base.extend({
				nativeSessionId: z.string().optional(),
				terminalId: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const chat = nativeChatProjection(ctx, input);
			if (chat) return chat;
			let ready: Awaited<ReturnType<typeof ensure>>;
			try {
				ready = await ensure(ctx, input);
			} catch (error) {
				if (error instanceof NativeCliOnlyError)
					return cliOnlyProjection(ctx, input, error.message);
				throw error;
			}
			const { broker, identity, launch } = ready;
			if (!identity)
				return {
					source: "native-session" as const,
					workspaceId: input.workspaceId,
					provider: input.provider,
					profileHash: launch.profileHash,
					nativeSessionId: null,
					cwd: launch.cwd,
					terminalId: input.terminalId ?? null,
					chatSessionId: null,
					activeWriter: "none" as const,
					leaseEpoch: 0,
					turnState: "unknown" as const,
					turnId: null,
					pendingApprovals: [],
					supported: true,
					controlMode:
						input.provider === "codex"
							? ("shared-daemon" as const)
							: ("quiesced-resume" as const),
					verification: "awaiting-native-hook",
				};
			const state = broker.state(identity);
			if (state.chatSessionId) {
				const live = ctx.runtime.chat?.().live.get(state.chatSessionId);
				if (live)
					broker.setTurnState(
						identity,
						live.busy
							? "running"
							: live.state.status === "awaiting_input"
								? "awaiting-approval"
								: "idle",
					);
			}
			return result(broker.state(identity));
		}),
	claimNativeControl: protectedProcedure
		.input(leased.extend({ closeCli: z.boolean().optional() }))
		.mutation(async ({ ctx, input }) => {
			const { broker, identity, launch } = await ensure(ctx, input);
			if (!identity) throw new TRPCError({ code: "NOT_FOUND" });
			return result(
				await broker.claim(
					identity,
					input.expectedLeaseEpoch,
					async () => {
						const state = broker.state(identity);
						if (
							!(await nativeCliRunning(
								ctx,
								input.workspaceId,
								state.terminalId,
							))
						)
							return false;
						if (!input.closeCli) return true;
						assertNativeBindingIdle(
							getTerminalAgentBinding(ctx.db, state.terminalId ?? ""),
						);
						if (!state.terminalId) return false;
						const closed = await disposeSessionAndWait(
							state.terminalId,
							ctx.db,
						);
						if (!closed.daemonCloseSucceeded)
							throw new TRPCError({
								code: "CONFLICT",
								message: "CLI exit could not be confirmed",
							});
						return false;
					},
					input.provider === "codex"
						? undefined
						: () =>
								loadControl(
									ctx,
									{ ...input, agentConfigId: launch.agentConfigId },
									launch.cwd,
									launch.profileHash,
									launch.controlModeId,
								),
				),
			);
		}),
	openNativeCli: protectedProcedure
		.input(leased)
		.mutation(async ({ ctx, input }) => {
			const { broker, identity, launch } = await ensure(ctx, input);
			if (!identity) throw new TRPCError({ code: "NOT_FOUND" });
			return result(
				await broker.open(identity, input.expectedLeaseEpoch, async (state) => {
					if (
						state.terminalId &&
						(await nativeCliRunning(ctx, input.workspaceId, state.terminalId))
					)
						return state.terminalId;
					if (state.chatSessionId) {
						const runtime = ctx.runtime.chat?.();
						const live = runtime?.live.get(state.chatSessionId);
						if (
							live &&
							(live.busy ||
								live.queuedCount ||
								live.state.backgroundTasks?.length)
						)
							throw new TRPCError({
								code: "CONFLICT",
								message: "Control agent is busy",
							});
						await runtime?.live.dispose(state.chatSessionId);
					}
					const daemon =
						input.provider === "codex"
							? await broker.daemons.ensure({
									...launch,
									args: launch.serverArgs,
									workspaceId: input.workspaceId,
								})
							: null;
					const args = nativeResumeArgs(
						input.provider,
						launch.resumeArgs,
						input.nativeSessionId,
						daemon ? `unix://${daemon.socketPath}` : undefined,
					);
					return spawnCli(ctx, input, launch, args);
				}),
			);
		}),
	controlNativeSession: protectedProcedure
		.input(
			leased.extend({
				action: z.discriminatedUnion("type", [
					z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
					z.object({ type: z.literal("interrupt") }),
					z.object({
						type: z.literal("approve"),
						requestId: z.string(),
						decision: z.enum(["accept", "decline"]),
					}),
				]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { broker, identity } = await ensure(ctx, input);
			if (!identity) throw new TRPCError({ code: "NOT_FOUND" });
			if (input.provider === "codex")
				return result(
					await broker.control(
						identity,
						input.expectedLeaseEpoch,
						input.action,
					),
				);
			await broker.withControl(
				identity,
				input.expectedLeaseEpoch,
				async (state) => {
					const runtime = ctx.runtime.chat?.();
					const live = state.chatSessionId
						? runtime?.live.get(state.chatSessionId)
						: null;
					if (!runtime || !live || !state.chatSessionId)
						throw new TRPCError({
							code: "CONFLICT",
							message: "Control agent is not loaded",
						});
					const common = {
						commandId: randomUUID(),
						sessionId: state.chatSessionId,
					};
					if (input.action.type === "prompt") {
						if (live.busy || live.queuedCount)
							throw new TRPCError({
								code: "CONFLICT",
								message: "Agent is busy",
							});
						runtime.commands.prompt({
							...common,
							clientId: randomUUID(),
							content: [{ type: "text", text: input.action.text }],
						});
					} else if (input.action.type === "interrupt") {
						if (live.turn)
							runtime.commands.cancelTurn({ ...common, turnId: live.turn.id });
					} else
						runtime.commands.respondToApproval({
							...common,
							approvalId: input.action.requestId,
							decision: { type: input.action.decision },
						});
				},
			);
			return result(broker.state(identity));
		}),
	nativeSessionHistory: protectedProcedure
		.input(identified.extend({ cursor: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const { broker, identity } = await ensure(ctx, input);
			if (!identity) throw new TRPCError({ code: "NOT_FOUND" });
			if (input.provider === "codex")
				return broker.history(identity, input.cursor);
			return nativeControlProjection(
				ctx.runtime.chat?.().commands,
				broker.state(identity).chatSessionId,
				input.cursor,
			);
		}),
};
