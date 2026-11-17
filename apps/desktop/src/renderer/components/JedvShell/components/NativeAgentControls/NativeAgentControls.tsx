import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LocalClient } from "../../local-client";
import type { NativeState } from "../../types";
import {
	type ApprovalDetail,
	ApprovalPreview,
} from "./components/ApprovalPreview";
import { ChatSessionControl } from "./components/ChatSessionControl";
import {
	createLocalPromptDraft,
	LocalPromptComposer,
} from "./components/LocalPromptComposer";
import type { LocalPromptDraft } from "./components/LocalPromptComposer/utils/prompt";
import { NativeSessionHistory } from "./components/NativeSessionHistory";

const providers = ["codex", "claude", "agy", "kimi"] as const;
type Provider = (typeof providers)[number];
const labels = {
	codex: "Codex",
	claude: "Claude Code",
	agy: "Antigravity",
	kimi: "Kimi Code",
};
function isProvider(value: string): value is Provider {
	return providers.some((provider) => provider === value);
}

export function NativeAgentControls({
	client,
	hostUrl,
	workspaceId,
	terminalId,
	onTerminal,
	launched,
	onStateChange,
	popoverOpen = false,
	remote = true,
	inline = false,
	initialDraft,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	terminalId: string | null;
	onTerminal?(id: string | null): Promise<void>;
	launched?: {
		provider: Provider;
		terminalId?: string;
		nativeSessionId?: string;
		agentConfigId?: string;
		chatSessionId?: string;
		bindingTerminalId?: string;
	} | null;
	onStateChange?(state: NativeState | null): void;
	popoverOpen?: boolean;
	remote?: boolean;
	inline?: boolean;
	initialDraft?: LocalPromptDraft;
}) {
	const { t } = useLingui();
	const [selection, setSelection] = useState<{
		provider: Provider;
		nativeSessionId?: string;
		agentConfigId?: string;
		chatSessionId?: string;
		bindingTerminalId?: string;
		terminalId?: string;
	} | null>(null);
	useEffect(() => {
		setSelection(launched ?? null);
	}, [launched]);
	const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
	useEffect(() => {
		if (!popoverOpen || inline) {
			setPortalTarget(null);
			return;
		}
		const frame = requestAnimationFrame(() =>
			setPortalTarget(document.getElementById("jedv-control-anchor")),
		);
		return () => cancelAnimationFrame(frame);
	}, [popoverOpen, inline]);
	const [draftOwner] = useState(() => ({
		draft: initialDraft ?? createLocalPromptDraft(),
		owned: !initialDraft,
	}));
	const draft = draftOwner.draft;
	useEffect(
		() => () => {
			if (draftOwner.owned) draftOwner.draft.attachments.clear();
		},
		[draftOwner],
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	const capabilities = useQuery({
		queryKey: ["jedv", hostUrl, "native-capabilities"],
		queryFn: () => client.terminalAgents.controlCapabilities.query(),
		retry: false,
	});
	const bindings = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "native-bindings"],
		queryFn: () => client.terminalAgents.listByWorkspace.query({ workspaceId }),
		refetchInterval: 3_000,
	});
	const directBinding = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "terminal-binding", terminalId],
		queryFn: terminalId
			? () => client.terminalAgents.get.query({ workspaceId, terminalId })
			: skipToken,
		refetchInterval: popoverOpen ? 2_000 : false,
		retry: false,
	});
	const agentConfigs = useQuery({
		queryKey: ["jedv", hostUrl, "agent-configs"],
		queryFn: () => client.settings.agentConfigs.list.query(),
		retry: false,
	});
	useEffect(() => {
		if (!popoverOpen) return;
		void bindings.refetch();
		if (terminalId) void directBinding.refetch();
	}, [popoverOpen, terminalId, bindings.refetch, directBinding.refetch]);
	const binding =
		bindings.data?.find(
			(item) => item.terminalId === terminalId && !item.endedAt,
		) ??
		directBinding.data ??
		bindings.data?.find((item) => item.terminalId === terminalId);
	const resolvedPresetId = binding?.definitionId
		? agentConfigs.data?.find((item) => item.id === binding.definitionId)
				?.presetId
		: undefined;
	const boundProvider = binding
		? isProvider(binding.agentId)
			? binding.agentId
			: resolvedPresetId && isProvider(resolvedPresetId)
				? resolvedPresetId
				: null
		: null;
	const selected =
		selection &&
		(selection.terminalId === terminalId ||
			(terminalId === null && !!selection.chatSessionId))
			? selection
			: null;
	const provider = boundProvider ?? selected?.provider;
	const nativeSessionId = binding?.agentSessionId ?? selected?.nativeSessionId;
	const agentConfigId = binding?.definitionId ?? selected?.agentConfigId;
	const directChatSessionId = binding?.chatSessionId ?? selected?.chatSessionId;
	const session = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"native-session",
			provider,
			agentConfigId,
			nativeSessionId,
			terminalId,
		],
		queryFn:
			provider && !directChatSessionId
				? () =>
						client.terminalAgents.queryNativeSession.query({
							workspaceId,
							provider,
							nativeSessionId,
							agentConfigId,
							terminalId: terminalId ?? selected?.bindingTerminalId,
						})
				: skipToken,
		refetchInterval: provider && !directChatSessionId ? 2_000 : false,
		retry: false,
	});
	const state = directChatSessionId ? undefined : session.data;
	const onStateRef = useRef(onStateChange);
	onStateRef.current = onStateChange;
	useEffect(() => {
		onStateRef.current?.(state ?? null);
	}, [state]);
	const chatSessionId =
		directChatSessionId ??
		(state && "source" in state && state.source === "chat-session"
			? state.chatSessionId
			: undefined);
	const identity =
		state?.nativeSessionId && !chatSessionId
			? {
					workspaceId,
					provider: state.provider,
					nativeSessionId: state.nativeSessionId,
					agentConfigId,
				}
			: null;
	const history = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"native-history",
			identity?.provider,
			identity?.nativeSessionId,
			state?.profileHash,
		],
		queryFn:
			identity && historyOpen
				? () => client.terminalAgents.nativeSessionHistory.query(identity)
				: skipToken,
		retry: false,
		refetchInterval: historyOpen ? 2_000 : false,
	});
	const run = async (action: () => Promise<void>) => {
		setPending(true);
		setError(null);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(false);
			if (provider && !directChatSessionId) await session.refetch();
		}
	};
	const refreshCapabilities = async () => {
		await capabilities.refetch();
		if (provider && !directChatSessionId) await session.refetch();
	};
	const capable = !!state?.supported && !!identity;
	const initialDraftKey = !draftOwner.owned
		? `${hostUrl}:${workspaceId}:draft:${provider ?? binding?.agentId ?? "cli"}:${nativeSessionId ?? terminalId ?? "none"}`
		: null;
	const idle = state?.turnState === "idle";
	const nativeContent = (
		<section
			className="border-b border-border px-3 py-2 text-xs"
			aria-label={t({ message: "Agent control" })}
		>
			{!state && !binding && (
				<p className="text-sm text-muted-foreground">
					<Trans>
						Select an agent terminal to inspect or control its current session.
					</Trans>
				</p>
			)}
			{!state && binding && (
				<div className="space-y-1">
					<p className="text-sm font-medium">
						{provider ? labels[provider] : binding.agentId}
					</p>
					<p className="text-xs text-muted-foreground">
						{provider && session.isPending ? (
							<Trans>Loading agent session…</Trans>
						) : binding.endedAt ? (
							<Trans>Ended</Trans>
						) : (
							<Trans>Terminal owns this session</Trans>
						)}
					</p>
				</div>
			)}

			{state && (
				<div className="mt-2 space-y-2">
					<div className="space-y-1">
						<p className="text-sm font-medium">{labels[state.provider]}</p>
						<p className="text-xs text-muted-foreground">
							{state.activeWriter === "cli" ? (
								<Trans>Terminal owns this session</Trans>
							) : state.activeWriter === "control" ? (
								<Trans>Control owns this session</Trans>
							) : (
								<Trans>No active writer</Trans>
							)}{" "}
							·{" "}
							{state.turnState === "running" ? (
								<Trans>Working</Trans>
							) : state.turnState === "awaiting-approval" ? (
								<Trans>Approval required</Trans>
							) : state.turnState === "idle" ? (
								<Trans>Idle</Trans>
							) : (
								<Trans>Status unavailable</Trans>
							)}
						</p>
					</div>
					{!state.supported && (
						<p className="text-muted-foreground">
							<Trans>
								CLI remains available. Structured control is unavailable for
								this session; check capabilities or continue in its terminal.
							</Trans>
						</p>
					)}
					<Button
						variant="ghost"
						size="sm"
						disabled={capabilities.isFetching || session.isFetching}
						onClick={() => void refreshCapabilities()}
					>
						<Trans>Refresh capabilities</Trans>
					</Button>
					{!onTerminal && (
						<p className="text-xs text-muted-foreground">
							<Trans>Opening the CLI is unavailable in this dialog.</Trans>
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={
								pending || !capable || !idle || state.activeWriter === "control"
							}
							onClick={() =>
								void run(async () => {
									if (!identity) return;
									const result =
										await client.terminalAgents.claimNativeControl.mutate({
											...identity,
											expectedLeaseEpoch: state.leaseEpoch,
										});
									setSelection({
										provider: result.provider,
										agentConfigId,
										nativeSessionId: result.nativeSessionId ?? undefined,
										terminalId: result.terminalId ?? undefined,
									});
								})
							}
						>
							<Trans>Take control</Trans>
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={
								pending ||
								!capable ||
								!idle ||
								!onTerminal ||
								state.activeWriter !== "cli"
							}
							onClick={() =>
								void run(async () => {
									if (!identity) return;
									if (
										!window.confirm(
											t({
												message:
													"Close this CLI terminal and take control of the same session? The terminal process will stop. Other terminal work may be lost.",
											}),
										)
									)
										return;
									const result =
										await client.terminalAgents.claimNativeControl.mutate({
											...identity,
											expectedLeaseEpoch: state.leaseEpoch,
											closeCli: true,
										});
									setSelection({
										provider: result.provider,
										agentConfigId,
										nativeSessionId: result.nativeSessionId ?? undefined,
									});
									await onTerminal?.(null);
								})
							}
						>
							<Trans>Close CLI terminal and take control</Trans>
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={
								pending ||
								!capable ||
								!idle ||
								!onTerminal ||
								state.activeWriter === "cli"
							}
							onClick={() =>
								void run(async () => {
									if (!identity) return;
									const result =
										await client.terminalAgents.openNativeCli.mutate({
											...identity,
											expectedLeaseEpoch: state.leaseEpoch,
										});
									setSelection({
										provider: result.provider,
										agentConfigId,
										nativeSessionId: result.nativeSessionId ?? undefined,
										terminalId: result.terminalId ?? undefined,
									});
									if (result.terminalId) await onTerminal?.(result.terminalId);
								})
							}
						>
							{state.activeWriter === "none" ? (
								<Trans>Resume same session</Trans>
							) : (
								<Trans>Open CLI</Trans>
							)}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={
								pending ||
								!capable ||
								state.activeWriter !== "control" ||
								state.turnState !== "running"
							}
							onClick={() =>
								void run(async () => {
									if (identity)
										await client.terminalAgents.controlNativeSession.mutate({
											...identity,
											expectedLeaseEpoch: state.leaseEpoch,
											action: { type: "interrupt" },
										});
								})
							}
						>
							<Trans>Interrupt</Trans>
						</Button>
					</div>
					{state.activeWriter === "control" && capable && (
						<LocalPromptComposer
							client={client}
							hostUrl={hostUrl}
							workspaceId={workspaceId}
							remote={remote}
							draft={draft}
							targetKey={
								initialDraftKey ??
								`${hostUrl}:${workspaceId}:native:${state.provider}:${state.nativeSessionId}`
							}
							disabled={pending || !idle}
							submitLabel={t({ message: "Send" })}
							onSubmitText={async (text) => {
								if (!identity)
									throw new Error(
										t({ message: "The session identity is unavailable." }),
									);
								await client.terminalAgents.controlNativeSession.mutate({
									...identity,
									expectedLeaseEpoch: state.leaseEpoch,
									action: { type: "prompt", text },
								});
								void session.refetch();
							}}
						/>
					)}
					{state.pendingApprovals.map((approval) => (
						<div
							key={approval.requestId}
							className="space-y-3 rounded-md border border-border p-3"
						>
							<ApprovalPreview
								detail={(approval as { detail?: ApprovalDetail }).detail}
							/>
							<div className="flex items-center gap-2">
								{(["accept", "decline"] as const).map((decision) => (
									<Button
										key={decision}
										variant="outline"
										size="sm"
										disabled={pending || state.activeWriter !== "control"}
										onClick={() =>
											void run(async () => {
												if (identity)
													await client.terminalAgents.controlNativeSession.mutate(
														{
															...identity,
															expectedLeaseEpoch: state.leaseEpoch,
															action: {
																type: "approve",
																requestId: approval.requestId,
																decision,
															},
														},
													);
											})
										}
									>
										{decision === "accept" ? (
											<Trans>Accept</Trans>
										) : (
											<Trans>Decline</Trans>
										)}
									</Button>
								))}
							</div>
						</div>
					))}
					<details
						onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
					>
						<summary className="cursor-pointer text-muted-foreground">
							<Trans>History</Trans>
						</summary>
						{history.error ? (
							<p role="alert" className="text-xs text-destructive">
								{history.error.message}
							</p>
						) : history.data ? (
							<NativeSessionHistory data={history.data} />
						) : (
							<p className="text-xs text-muted-foreground">…</p>
						)}
						<Button
							size="sm"
							variant="ghost"
							disabled={!identity || history.isFetching}
							onClick={() => void history.refetch()}
						>
							<Trans>Refresh</Trans>
						</Button>
					</details>
				</div>
			)}
			{terminalId &&
				binding &&
				!binding.chatSessionId &&
				state?.activeWriter !== "control" && (
					<div className="mt-3 space-y-1">
						<p className="text-xs text-muted-foreground">
							<Trans>
								Insert into the existing CLI, then submit in the terminal.
							</Trans>
						</p>
						<LocalPromptComposer
							client={client}
							hostUrl={hostUrl}
							workspaceId={workspaceId}
							remote={remote}
							draft={draft}
							targetKey={
								initialDraftKey ??
								`${hostUrl}:${workspaceId}:cli:${terminalId}:${binding.agentSessionId}`
							}
							disabled={pending}
							submitLabel={t({ message: "Insert into CLI" })}
							onSubmitText={async (text) => {
								const fresh = await client.terminalAgents.get.query({
									workspaceId,
									terminalId,
								});
								const terminals = await client.terminal.list.query({
									workspaceId,
								});
								if (
									!fresh ||
									fresh.chatSessionId ||
									fresh.agentId !== binding.agentId ||
									fresh.agentSessionId !== binding.agentSessionId ||
									!terminals.sessions.some(
										(row) => row.terminalId === terminalId && !row.exited,
									)
								)
									throw new Error(
										t({
											message:
												"The terminal session changed. Refresh before inserting the prompt.",
										}),
									);
								await client.terminal.send.mutate({
									workspaceId,
									terminalId,
									text,
									submit: false,
								});
							}}
						/>
					</div>
				)}
			<details className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
				<summary className="cursor-pointer">
					<Trans>Diagnostics</Trans>
				</summary>
				{state && (
					<dl className="mt-2 space-y-1 break-all">
						<dt>
							<Trans>Session ID</Trans>
						</dt>
						<dd>{state.nativeSessionId}</dd>
						<dt>
							<Trans>Working directory</Trans>
						</dt>
						<dd>{state.cwd}</dd>
						<dt>
							<Trans>Control mode</Trans>
						</dt>
						<dd>
							{state.controlMode} · {state.verification} · epoch{" "}
							{state.leaseEpoch}
						</dd>
						{"reason" in state && <dd>{state.reason}</dd>}
					</dl>
				)}
				{capabilities.data
					?.filter((capability) => capability.provider === provider)
					.map((capability) => (
						<p key={capability.provider} className="mt-2">
							{capability.verification} · {capability.reason}
						</p>
					))}
			</details>

			{(error || capabilities.error || session.error) && (
				<p role="alert">
					{error ?? capabilities.error?.message ?? session.error?.message}
				</p>
			)}
		</section>
	);
	const content = chatSessionId ? (
		<section className="p-3">
			<ChatSessionControl
				key={`${hostUrl}:${chatSessionId}`}
				client={client}
				hostUrl={hostUrl}
				workspaceId={workspaceId}
				sessionId={chatSessionId}
				remote={remote}
				draft={draft}
				turnId={state?.turnId ?? null}
				working={
					state?.turnState === "running" ||
					state?.turnState === "awaiting-approval"
				}
				onRefresh={() => bindings.refetch()}
			/>
		</section>
	) : (
		nativeContent
	);
	return inline
		? content
		: portalTarget
			? createPortal(content, portalTarget)
			: null;
}
