import { isDurableEnvelope } from "@jedv/chat/protocol";
import type { ChatRuntime } from "@jedv/chat-runtime";
import { TRPCError } from "@trpc/server";
import { acpHarnessForPreset } from "../chat-v3/acpCatalogue";
import { resolveHostAgentConfig } from "../terminal-agents/agent-config";
import {
	chatLaunchPresetId,
	runAgentInWorkspace,
} from "../trpc/router/agents/agents";
import { seedDefaultsIfEmpty } from "../trpc/router/settings/agent-configs";
import { workspacesRouter } from "../trpc/router/workspaces/workspaces";
import type { HostServiceContext } from "../types";
import type { AutomationExecutor } from "./automations";
import type { RunUpdate } from "./schema";

export function executeChatPrompt(options: {
	chat: ChatRuntime;
	sessionId: string;
	prompt: string;
	runId: string;
	update: (patch: RunUpdate) => void;
	signal: AbortSignal;
	readyTimeoutMs?: number;
}): Promise<void> {
	const { chat, sessionId, prompt, runId, update, signal } = options;
	return new Promise((resolve, reject) => {
		let sent = false;
		let settled = false;
		let unsubscribe: (() => void) | undefined;
		let turnId: string | undefined;
		let nativeSessionId: string | undefined;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			unsubscribe?.();
			signal.removeEventListener("abort", abort);
			if (error) reject(error);
			else resolve();
		};
		const abort = () =>
			finish(new Error("Automation stopped before completion"));
		const timeout = setTimeout(
			() =>
				finish(
					new Error("Agent protocol did not become ready; prompt was not sent"),
				),
			options.readyTimeoutMs ?? 60_000,
		);
		timeout.unref();
		const inspect = () => {
			if (settled) return;
			try {
				const live = chat.live.get(sessionId);
				if (!live || live.state.status === "dead") {
					finish(
						chat.sessions.get(sessionId)?.closedByUser
							? new DOMException(
									"Agent session interrupted by user",
									"AbortError",
								)
							: new Error(
									"Agent session ended without completing the automation",
								),
					);
					return;
				}
				if (
					live.state.harnessSessionId &&
					live.state.harnessSessionId !== nativeSessionId
				) {
					nativeSessionId = live.state.harnessSessionId;
					update({ nativeSessionId });
				}
				if (
					!sent &&
					live.state.harnessSessionId &&
					["idle", "awaiting_input"].includes(live.state.status)
				) {
					sent = true;
					clearTimeout(timeout);
					chat.commands.prompt({
						commandId: runId,
						sessionId,
						clientId: "jedv-automations",
						content: [{ type: "text", text: prompt }],
					});
				}
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		};
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}
		const subscription = chat.subscribe(
			sessionId,
			{ deltas: [] },
			{
				send(envelope) {
					if (settled) return;
					try {
						if ("reset" in envelope) {
							finish(new Error("Agent journal could not be observed"));
							return;
						}
						if (isDurableEnvelope(envelope) && sent) {
							const event = envelope.event;
							if (event.type === "turn") {
								turnId ??= event.turn.id;
								if (event.turn.id === turnId) {
									if (event.turn.status === "running")
										update({ status: "running" });
									else if (event.turn.status === "completed") finish();
									else if (event.turn.status === "interrupted")
										finish(
											new DOMException("Agent turn interrupted", "AbortError"),
										);
									else
										finish(
											new Error(
												event.turn.error?.message ??
													`Agent turn ${event.turn.status}`,
											),
										);
								}
							} else if (
								event.type === "item" &&
								event.item.kind === "approval_request"
							) {
								update({
									status:
										event.item.status === "pending"
											? "awaiting-approval"
											: "running",
								});
							}
						}
						queueMicrotask(inspect);
					} catch (error) {
						finish(error instanceof Error ? error : new Error(String(error)));
					}
				},
				close() {
					finish(new Error("Agent event stream closed before completion"));
				},
			},
		);
		unsubscribe = () => subscription.unsubscribe();
		if (settled) unsubscribe();
		else queueMicrotask(inspect);
	});
}

export function createAutomationExecutor(
	ctx: HostServiceContext,
): AutomationExecutor {
	return async (definition, run, update, signal) => {
		seedDefaultsIfEmpty(ctx.db);
		const config = resolveHostAgentConfig(
			ctx.db,
			definition.agentConfigId ?? definition.agent,
		);
		if (!config || chatLaunchPresetId(config) !== definition.agent)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Agent configuration does not match automation provider",
			});
		const chat = ctx.runtime.chat?.();
		const harness = acpHarnessForPreset(definition.agent);
		if (!chat || !harness || !chat.live.supports(harness))
			throw new Error(
				"Native agent adapter is unavailable; no terminal fallback was launched",
			);
		let workspaceId: string;
		if (definition.target.kind === "workspace")
			workspaceId = definition.target.workspaceId;
		else {
			const created = await workspacesRouter.createCaller(ctx).create({
				id: run.id,
				projectId: definition.target.projectId,
				name: `${definition.name}-${run.id.slice(0, 8)}`,
				baseBranch: definition.target.baseBranch,
				tags: ["automation"],
				runSetup: false,
			});
			workspaceId = created.workspace.id;
		}
		update({ workspaceId });
		if (signal.aborted)
			throw new Error("Automation stopped before agent launch");
		const launched = await runAgentInWorkspace(ctx, {
			workspaceId,
			agent: config.id,
			prompt: "",
			surface: "chat",
		});
		if (!launched.chatSessionId)
			throw new Error("Automation requires a native protocol session");
		update({
			terminalId: launched.sessionId,
			chatSessionId: launched.chatSessionId,
		});
		try {
			await executeChatPrompt({
				chat,
				sessionId: launched.chatSessionId,
				prompt: definition.prompt,
				runId: run.id,
				update,
				signal,
			});
		} finally {
			if (!signal.aborted) {
				try {
					await chat.commands.closeSession({
						sessionId: launched.chatSessionId,
						userClosed: false,
					});
				} catch (error) {
					console.error("[automations] agent session cleanup failed", error);
				}
			}
		}
	};
}
