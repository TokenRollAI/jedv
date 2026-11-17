import {
	emptySnapshot,
	presetForAcpHarness,
	reduceMany,
} from "@jedv/chat/core";
import { Button } from "@jedv/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LuInfo, LuRefreshCw, LuSquare } from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { LocalClient } from "../../../../local-client";
import { RunOutputItem } from "../../../JedvAutomationsView/components/AutomationRuns/components/RunOutputItem/RunOutputItem";
import { LocalPromptComposer } from "../LocalPromptComposer";
import type { LocalPromptDraft } from "../LocalPromptComposer/utils/prompt";
import { NativeSessionHistory } from "../NativeSessionHistory";

export function ChatSessionControl({
	client,
	hostUrl,
	workspaceId,
	sessionId,
	title,
	turnId: nativeTurnId,
	working: nativeWorking,
	remote = true,
	fullHeight = false,
	draft,
	onRefresh,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	sessionId: string;
	title?: string;
	turnId: string | null;
	working: boolean;
	remote?: boolean;
	fullHeight?: boolean;
	draft: LocalPromptDraft;
	onRefresh(): Promise<unknown>;
}) {
	const { t } = useLingui();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const identity = { workspaceId, sessionId };
	const output = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, sessionId, "control-output"],
		queryFn: () => client.sessions.read.query({ ...identity, limit: 200 }),
		refetchInterval: 2_000,
	});
	const state = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, sessionId, "control-session"],
		queryFn: () => client.sessions.get.query(identity),
		refetchInterval: 2_000,
	});
	const snapshot = output.data?.ok
		? reduceMany(emptySnapshot(), output.data.envelopes)
		: emptySnapshot();
	const approvals = [...snapshot.items.values()]
		.map((stored) => stored.item)
		.filter((item) => item.kind === "approval_request");
	const activeTurn = [...snapshot.turns.values()]
		.filter((turn) => turn.status === "running")
		.sort((a, b) => b.startedAtMs - a.startedAtMs)[0];
	const turnId = activeTurn?.id ?? nativeTurnId;
	const working =
		state.data?.session.status === "running" ||
		state.data?.session.status === "starting" ||
		!!activeTurn ||
		nativeWorking;
	const sessionTitle =
		state.data?.session.title || title || t({ message: "Chat session" });
	const presetId = state.data?.session.harness
		? presetForAcpHarness(state.data.session.harness)
		: undefined;
	const run = async (action: () => Promise<unknown>) => {
		setPending(true);
		setError(null);
		try {
			await action();
			await Promise.all([output.refetch(), state.refetch(), onRefresh()]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(false);
		}
	};
	const controls = (
		<div className="flex shrink-0 items-center gap-1.5">
			<Button
				size="sm"
				variant="ghost"
				className="h-7 gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
				disabled={pending || !state.data?.live || !working || !turnId}
				onClick={() =>
					void run(() =>
						client.sessions.interrupt.mutate({
							...identity,
							turnId: turnId ?? undefined,
						}),
					)
				}
			>
				<LuSquare className="size-3" />
				<Trans>Interrupt</Trans>
			</Button>
			<Button
				size="sm"
				variant="ghost"
				className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-fill-hover hover:text-foreground"
				disabled={pending}
				onClick={() => void run(async () => {})}
			>
				<LuRefreshCw className="size-3" />
				<Trans>Refresh</Trans>
			</Button>
		</div>
	);
	const historyAndApprovals = (
		<>
			{output.data && (
				<NativeSessionHistory
					data={{ source: "control-projection", items: output.data }}
					variant={fullHeight ? "conversation" : "compact"}
					presetId={presetId}
					working={working}
				/>
			)}
			{approvals.map((item) => (
				<RunOutputItem
					key={item.id}
					item={item}
					pending={pending}
					canControl={state.data?.live === true}
					onApprove={(decision) =>
						void run(() =>
							client.sessions.respondApproval.mutate({
								...identity,
								itemId: item.id,
								decision,
							}),
						)
					}
				/>
			))}
			{state.data && !state.data.live && (
				<p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
					<Trans>
						This chat is read only. Use Start new session to begin another chat.
					</Trans>
				</p>
			)}
			{(error || output.error || state.error) && (
				<p role="alert" className="text-xs text-destructive">
					{error ?? output.error?.message ?? state.error?.message}
				</p>
			)}
		</>
	);
	const composer = (
		<LocalPromptComposer
			client={client}
			hostUrl={hostUrl}
			workspaceId={workspaceId}
			remote={remote}
			draft={draft}
			targetKey={`${hostUrl}:${workspaceId}:chat:${sessionId}`}
			disabled={pending || working || !state.data?.live}
			submitLabel={t({ message: "Send" })}
			onSubmitText={async (prompt) => {
				const fresh = await client.sessions.get.query(identity);
				if (!fresh.live || fresh.session.sessionId !== sessionId)
					throw new Error(
						t({
							message: "This chat is no longer live. The prompt was not sent.",
						}),
					);
				await client.sessions.send.mutate({ ...identity, prompt });
				void Promise.all([output.refetch(), state.refetch(), onRefresh()]);
			}}
		/>
	);
	if (fullHeight) {
		return (
			<div className="flex h-full min-h-0 flex-1 flex-col bg-background">
				<header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/85 px-4">
					<div className="flex min-w-0 items-center gap-2">
						{presetId && (
							<AgentIcon presetId={presetId} className="size-4 shrink-0" />
						)}
						<span className="truncate text-[13px] font-medium">
							{sessionTitle}
						</span>
						{state.data && (
							<span
								className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
									working
										? "bg-chart-1/12 text-chart-1"
										: state.data.live
											? "bg-success/12 text-success"
											: "bg-muted text-muted-foreground"
								}`}
							>
								{working && (
									<span className="size-1.5 animate-pulse rounded-full bg-current" />
								)}
								{working ? (
									<Trans>Working</Trans>
								) : state.data.live ? (
									<Trans>Live</Trans>
								) : (
									<Trans>Read only</Trans>
								)}
							</span>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label={t({
										message:
											"Control output only. Earlier CLI history is not included.",
									})}
									className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/75 transition-colors hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								>
									<LuInfo className="size-3.5" />
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-xs">
								<Trans>
									Control output only. Earlier CLI history is not included.
								</Trans>
							</TooltipContent>
						</Tooltip>
					</div>
					{controls}
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-6">
						{historyAndApprovals}
					</div>
				</div>
				<div className="shrink-0 bg-background px-6 pt-2 pb-5">
					<div className="mx-auto w-full max-w-3xl">{composer}</div>
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<p className="text-xs text-muted-foreground">
				<Trans>Existing chat session. No CLI terminal is attached.</Trans>
			</p>
			{controls}
			<div className="max-h-72 space-y-3 overflow-y-auto pr-1">
				{historyAndApprovals}
			</div>
			{composer}
		</div>
	);
}
