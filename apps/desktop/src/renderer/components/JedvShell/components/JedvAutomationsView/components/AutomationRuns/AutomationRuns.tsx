import type { Cursor, Item } from "@jedv/chat/protocol";
import { errorMessage } from "@jedv/i18n/errors";
import { formatCompactRelativeTime, formatDateTime } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LuArrowUpRight, LuRefreshCw, LuSquare } from "react-icons/lu";
import type { JedvParityViewContext } from "../../../../parity-types";
import type { AutomationRun } from "../../types";
import { runColors, runLabels } from "../../types";
import { RunOutputItem } from "./components/RunOutputItem/RunOutputItem";
export function AutomationRuns({
	client,
	hostUrl,
	automationId,
	onOpenWorkspace,
	initialRunId,
}: {
	client: JedvParityViewContext["client"];
	hostUrl: string;
	automationId: string;
	initialRunId?: string;
	onOpenWorkspace: JedvParityViewContext["onOpenWorkspace"];
}) {
	const { t, i18n } = useLingui();
	const [selected, setSelected] = useState<AutomationRun | null>(null);
	const [before, setBefore] = useState<Cursor | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const runs = useQuery({
		queryKey: ["jedv", hostUrl, "automation-runs", automationId],
		queryFn: () => client.automations.listRuns.query({ automationId }),
		refetchInterval: 3000,
		retry: false,
	});
	const run =
		runs.data?.find((r) => r.id === (selected?.id ?? initialRunId)) ?? selected;
	const identity =
		run?.workspaceId && run.chatSessionId
			? { workspaceId: run.workspaceId, sessionId: run.chatSessionId }
			: null;
	const output = useQuery({
		queryKey: ["jedv", hostUrl, "automation-output", run?.id, before],
		enabled: !!run?.workspaceId && !!run?.chatSessionId,
		queryFn: identity
			? () =>
					client.sessions.read.query({
						...identity,
						limit: 200,
						before,
					})
			: skipToken,
		refetchInterval: before ? false : 2000,
		retry: false,
	});
	const session = useQuery({
		queryKey: ["jedv", hostUrl, "automation-session", run?.id],
		enabled: !!run?.workspaceId && !!run?.chatSessionId,
		queryFn: identity ? () => client.sessions.get.query(identity) : skipToken,
		refetchInterval: 3000,
		retry: false,
	});
	const action = useMutation({
		mutationFn: async (
			input:
				| { kind: "interrupt" }
				| {
						kind: "approval";
						itemId: string;
						decision: Parameters<
							typeof client.sessions.respondApproval.mutate
						>[0]["decision"];
				  },
		) => {
			if (!run?.workspaceId || !run.chatSessionId)
				throw new Error(t({ message: "This run has no agent session" }));
			const common = {
				workspaceId: run.workspaceId,
				sessionId: run.chatSessionId,
			};
			if (input.kind === "interrupt")
				await client.sessions.interrupt.mutate(common);
			else
				await client.sessions.respondApproval.mutate({
					...common,
					itemId: input.itemId,
					decision: input.decision,
				});
			return input.kind;
		},
		onMutate: () => {
			setError(null);
			setNotice(null);
		},
		onSuccess: (kind) => {
			setNotice(
				kind === "interrupt"
					? t({ message: "Interrupt requested" })
					: t({ message: "Approval response sent" }),
			);
			void output.refetch();
			void session.refetch();
			void runs.refetch();
		},
		onError: (cause) =>
			setError(errorMessage(cause, t({ message: "Failed to control run" }))),
	});
	const items = new Map<string, Item>();
	if (output.data?.ok)
		for (const envelope of output.data.envelopes)
			if (envelope.event.type === "item")
				items.set(envelope.event.item.id, envelope.event.item);
	const active =
		!!run && ["starting", "running", "awaiting-approval"].includes(run.status);
	return (
		<div className="mx-auto w-full max-w-4xl px-8 py-6">
			<h2 className="mb-4 text-sm font-medium">
				<Trans>Run History</Trans>
			</h2>
			{runs.isPending && (
				<output className="text-xs text-muted-foreground">
					<Trans>Loading runs…</Trans>
				</output>
			)}
			{runs.error && (
				<div role="alert" className="text-xs text-destructive">
					{errorMessage(runs.error, t({ message: "Failed to load runs" }))}
					<Button size="sm" variant="ghost" onClick={() => void runs.refetch()}>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			{initialRunId &&
				!selected &&
				runs.isSuccess &&
				!runs.data.some((item) => item.id === initialRunId) && (
					<p role="alert" className="mb-3 text-xs text-muted-foreground">
						<Trans>The requested run is not in the loaded history.</Trans>
					</p>
				)}
			{runs.data?.length === 0 && (
				<p className="text-sm italic text-muted-foreground">
					<Trans>No runs yet</Trans>
				</p>
			)}
			<ul className="space-y-0.5">
				{runs.data?.map((item) => (
					<li key={item.id}>
						<button
							type="button"
							onClick={() => {
								setSelected(item);
								setBefore(undefined);
								setError(null);
								setNotice(null);
							}}
							aria-pressed={run?.id === item.id}
							className={cn(
								"flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent/40",
								run?.id === item.id && "bg-accent/40",
							)}
						>
							<span
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									runColors[item.status],
								)}
							/>
							<span>{i18n._(runLabels[item.status])}</span>
							<span className="text-muted-foreground">
								{item.trigger === "manual" ? (
									<Trans>Manual</Trans>
								) : (
									<Trans>Scheduled</Trans>
								)}
							</span>
							<time
								title={formatDateTime(item.createdAt)}
								className="ml-auto text-muted-foreground"
							>
								{formatCompactRelativeTime(item.createdAt)}
							</time>
						</button>
						{item.error && (
							<p className="mx-2 mb-1 whitespace-pre-wrap rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
								{item.error}
							</p>
						)}
					</li>
				))}
			</ul>
			{run && (
				<div className="mt-6 rounded-xl border border-border">
					<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
						<h3 className="text-sm font-medium">
							<Trans>Run output</Trans>
						</h3>
						<span className="text-xs text-muted-foreground">
							{i18n._(runLabels[run.status])}
						</span>
						<div className="ml-auto flex gap-1">
							<Button
								size="sm"
								variant="ghost"
								className="h-7 text-xs"
								onClick={() => {
									void output.refetch();
									void session.refetch();
									void runs.refetch();
								}}
							>
								<LuRefreshCw className="size-3" />
								<Trans>Refresh</Trans>
							</Button>
							{run.workspaceId && (
								<Button
									size="sm"
									variant="ghost"
									className="h-7 text-xs"
									onClick={() =>
										void onOpenWorkspace(run.workspaceId ?? "", null).catch(
											(cause) =>
												setError(
													errorMessage(
														cause,
														t({ message: "Failed to open workspace" }),
													),
												),
										)
									}
								>
									<LuArrowUpRight className="size-3" />
									<Trans>Open workspace</Trans>
								</Button>
							)}
							{active && run.chatSessionId && (
								<Button
									size="sm"
									variant="outline"
									className="h-7 text-xs"
									disabled={action.isPending}
									onClick={() => action.mutate({ kind: "interrupt" })}
								>
									<LuSquare className="size-3" />
									<Trans>Interrupt</Trans>
								</Button>
							)}
						</div>
					</div>
					<div className="space-y-3 p-4">
						{(error || output.error || session.error) && (
							<p
								role="alert"
								className="whitespace-pre-wrap text-xs text-destructive"
							>
								{error ??
									errorMessage(
										output.error ?? session.error,
										t({ message: "Failed to load run output" }),
									)}
							</p>
						)}
						{notice && (
							<output className="text-xs text-muted-foreground">
								{notice}
							</output>
						)}
						{output.isFetching && (
							<output className="text-xs text-muted-foreground">
								<Trans>Loading output…</Trans>
							</output>
						)}
						{!run.chatSessionId && (
							<p className="text-xs text-muted-foreground">
								<Trans>Agent session has not been created yet</Trans>
							</p>
						)}
						{output.data && !output.data.ok && (
							<p role="alert" className="text-xs text-destructive">
								<Trans>Run history is unavailable. Refresh to try again.</Trans>
							</p>
						)}
						{output.data?.ok && output.data.nextBefore && (
							<Button
								size="sm"
								variant="ghost"
								className="h-7 text-xs"
								onClick={() =>
									setBefore(
										output.data?.ok
											? (output.data.nextBefore ?? undefined)
											: undefined,
									)
								}
							>
								<Trans>Earlier output</Trans>
							</Button>
						)}
						{before && (
							<Button
								size="sm"
								variant="ghost"
								className="h-7 text-xs"
								onClick={() => setBefore(undefined)}
							>
								<Trans>Latest output</Trans>
							</Button>
						)}
						{output.data?.ok && items.size === 0 && !output.isPending && (
							<p className="text-xs text-muted-foreground">
								<Trans>No output yet</Trans>
							</p>
						)}
						{Array.from(items.values()).map((item) => (
							<RunOutputItem
								key={`${run.id}:${item.id}`}
								item={item}
								pending={action.isPending}
								canControl={!before && active && session.data?.live === true}
								onApprove={(decision) =>
									action.mutate({ kind: "approval", itemId: item.id, decision })
								}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
