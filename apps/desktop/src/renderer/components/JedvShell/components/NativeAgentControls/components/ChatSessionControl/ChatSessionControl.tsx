import { emptySnapshot, reduceMany } from "@jedv/chat/core";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
	turnId: nativeTurnId,
	working: nativeWorking,
	remote = true,
	draft,
	onRefresh,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	sessionId: string;
	turnId: string | null;
	working: boolean;
	remote?: boolean;
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
	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground">
				<Trans>Existing chat session. No CLI terminal is attached.</Trans>
			</p>
			<div className="flex gap-2">
				<Button
					size="sm"
					variant="outline"
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
					<Trans>Interrupt</Trans>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={pending}
					onClick={() => void run(async () => {})}
				>
					<Trans>Refresh</Trans>
				</Button>
			</div>
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
				<p className="text-xs text-muted-foreground">
					<Trans>
						This chat is read only. Use Start new session to begin another chat.
					</Trans>
				</p>
			)}
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
								message:
									"This chat is no longer live. The prompt was not sent.",
							}),
						);
					await client.sessions.send.mutate({ ...identity, prompt });
					void Promise.all([output.refetch(), state.refetch(), onRefresh()]);
				}}
			/>

			{(error || output.error || state.error) && (
				<p role="alert" className="text-xs text-destructive">
					{error ?? output.error?.message ?? state.error?.message}
				</p>
			)}
			{output.data && (
				<NativeSessionHistory
					data={{ source: "control-projection", items: output.data }}
				/>
			)}
		</div>
	);
}
