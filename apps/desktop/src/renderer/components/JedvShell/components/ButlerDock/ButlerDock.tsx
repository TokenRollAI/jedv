import type {
	ButlerApprovalShape,
	ButlerSendResult,
} from "@jedv/shared/butler";
import { Badge } from "@jedv/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@jedv/ui/tabs";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import {
	LuChevronDown,
	LuChevronUp,
	LuHistory,
	LuPlus,
	LuRefreshCw,
} from "react-icons/lu";
import type { Team } from "../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../parity-types";
import { ButlerIcon } from "../ButlerIcon";
import { JedvIconButton } from "../JedvIconButton";
import { JedvSelect } from "../JedvSelect";
import { butlerAlertsSchema } from "./alerts";
import { ButlerConversation } from "./components/ButlerConversation";
import { ButlerInbox } from "./components/ButlerInbox";
export const butlerKey = (hostUrl: string) =>
	["jedv", hostUrl, "butler"] as const;
export function ButlerDock({
	context,
	teams,
	connected,
	onSettings,
}: {
	context: JedvParityViewContext;
	teams: Team[];
	connected: boolean;
	onSettings(): void;
}) {
	const { t } = useLingui();
	const { client, hostUrl } = context;
	const cache = useQueryClient();
	const contentId = useId();
	const [expanded, setExpanded] = useState(false),
		[selection, setSelection] = useState<string | null>(null),
		[tab, setTab] = useState("chat"),
		[showHistory, setShowHistory] = useState(false);
	const [sending, setSending] = useState(false),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	const [degraded, setDegraded] = useState<ButlerSendResult["reason"]>(null);
	const [blocked, setBlocked] = useState<Set<string>>(new Set());
	const busy = useRef(false);
	const capabilities = useQuery({
		queryKey: [...butlerKey(hostUrl), "capabilities"],
		queryFn: () => client.butler.capabilities.query(),
		enabled: connected,
		retry: false,
		refetchInterval: 30_000,
		gcTime: 30_000,
	});
	const supported =
		capabilities.data?.protocolVersion === 1 && !capabilities.isError;
	const inbox = useQuery({
		queryKey: [...butlerKey(hostUrl), "inbox"],
		queryFn: () => client.butler.inbox.query(),
		enabled: connected && supported,
		retry: false,
		refetchInterval: 15_000,
		gcTime: 30_000,
	});
	const threads = useQuery({
		queryKey: [...butlerKey(hostUrl), "threads"],
		queryFn: () => client.butler.listThreads.query({ limit: 50 }),
		enabled: connected && supported && expanded,
		retry: false,
		refetchInterval: 30_000,
		gcTime: 30_000,
	});
	const threadId =
		selection === "new" ? undefined : (selection ?? threads.data?.[0]?.id);
	useEffect(() => {
		if (selection === null && threads.isSuccess)
			setSelection(threads.data[0]?.id ?? "new");
	}, [selection, threads.isSuccess, threads.data]);
	const history = useQuery({
		queryKey: [...butlerKey(hostUrl), "history", threadId],
		queryFn: () =>
			client.butler.history.query({ threadId: threadId ?? "", limit: 100 }),
		enabled: connected && supported && expanded && !!threadId,
		retry: false,
		refetchInterval: 10_000,
		gcTime: 30_000,
	});
	const resolved = useQuery({
		queryKey: [...butlerKey(hostUrl), "approval-history"],
		queryFn: () =>
			client.butler.listApprovals.query({ status: "history", limit: 100 }),
		enabled: connected && supported && expanded && showHistory,
		retry: false,
		refetchInterval: 15_000,
		gcTime: 30_000,
	});
	const ai = useQuery({
		queryKey: ["jedv", hostUrl, "ai-settings"],
		queryFn: () => client.aiSettings.get.query(),
		enabled: connected && supported && expanded,
		retry: false,
		gcTime: 30_000,
	});
	const approvals = [
		...(inbox.data?.approvals ?? []),
		...(showHistory ? (resolved.data ?? []) : []),
	];
	const parsedAlerts = butlerAlertsSchema.safeParse(inbox.data?.alerts ?? []);
	const alerts = parsedAlerts.success ? parsedAlerts.data : [];
	const count = (inbox.data?.approvals.length ?? 0) + alerts.length;
	const failed =
		!parsedAlerts.success ||
		!connected ||
		capabilities.isError ||
		inbox.isError ||
		(capabilities.isSuccess && !supported) ||
		(expanded && threads.isError) ||
		(!!threadId && expanded && history.isError) ||
		(showHistory && resolved.isError);
	const unavailable = !connected || !supported || inbox.isError;
	const refresh = async () => {
		setError(false);
		try {
			await inbox.refetch({ throwOnError: true });
			if (showHistory) await resolved.refetch({ throwOnError: true });
			if (expanded) await threads.refetch({ throwOnError: true });
			if (threadId && expanded) await history.refetch({ throwOnError: true });
			setBlocked(new Set());
		} catch {
			setError(true);
		}
	};
	const resolve = async (
		approval: ButlerApprovalShape,
		decision: "approve" | "reject",
	) => {
		if (
			busy.current ||
			unavailable ||
			blocked.has(approval.id) ||
			approval.status !== "pending" ||
			approval.expiresAt <= Date.now()
		)
			return;
		busy.current = true;
		setPending(true);
		setError(false);
		try {
			await client.butler.resolveApproval.mutate({
				approvalId: approval.id,
				payloadHash: approval.payloadHash,
				decision,
			});
			await cache.invalidateQueries({ queryKey: butlerKey(hostUrl) });
		} catch {
			setBlocked((previous) => new Set([...previous, approval.id].slice(-100)));
			setError(true);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const read = async (id: string) => {
		if (busy.current || unavailable) return;
		busy.current = true;
		setPending(true);
		setError(false);
		try {
			await client.watchdog.markRead.mutate({ id });
			await cache.invalidateQueries({ queryKey: butlerKey(hostUrl) });
		} catch {
			setError(true);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<section
			className={`flex min-h-0 shrink-0 flex-col border-t border-sidebar-border ${expanded ? "h-[45%] max-h-[480px]" : "h-8"}`}
			aria-label={t({ message: "Butler" })}
		>
			<div className="flex h-8 shrink-0 items-center gap-1 px-2">
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={contentId}
					onClick={() => setExpanded(!expanded)}
					className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-xs text-sidebar-foreground hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ButlerIcon className="size-3.5 text-muted-foreground" />
					<Trans>Butler</Trans>
					{count > 0 && (
						<span className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
							<span className="size-1 rounded-full bg-warning" />
							{count}
							{alerts.length >= 20 ? "+" : ""}
						</span>
					)}
					{expanded ? (
						<LuChevronDown className="ml-auto size-3" />
					) : (
						<LuChevronUp className="ml-auto size-3" />
					)}
				</button>
				{expanded && (
					<JedvIconButton
						label={t({ message: "Refresh" })}
						className="size-6"
						disabled={pending || sending}
						onClick={() => void refresh()}
					>
						<LuRefreshCw className="size-3" />
					</JedvIconButton>
				)}
			</div>
			<div
				id={contentId}
				hidden={!expanded}
				className={expanded ? "flex min-h-0 flex-1 flex-col" : "hidden"}
			>
				{(failed || error) && (
					<div
						role="alert"
						className="shrink-0 px-2.5 py-1 text-[11px] text-destructive"
					>
						<Trans>Unavailable</Trans> ·{" "}
						<button
							type="button"
							className="rounded underline focus-visible:ring-1 focus-visible:ring-ring"
							disabled={pending || sending}
							onClick={() => {
								void capabilities.refetch();
								void refresh();
							}}
						>
							<Trans>Retry</Trans>
						</button>
					</div>
				)}
				<Tabs
					value={tab}
					onValueChange={setTab}
					className="flex min-h-0 flex-1 flex-col gap-0"
				>
					<TabsList className="mx-2 h-8 shrink-0">
						<TabsTrigger value="chat" className="text-[11px]">
							<Trans>Butler</Trans>
						</TabsTrigger>
						<TabsTrigger value="inbox" className="text-[11px]">
							<Trans>Inbox</Trans>
							{count > 0 && (
								<Badge
									variant="secondary"
									className="h-4 min-w-4 justify-center px-1 text-[10px] tabular-nums"
								>
									{count}
								</Badge>
							)}
						</TabsTrigger>
					</TabsList>
					<TabsContent
						value="chat"
						forceMount
						className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
					>
						<div className="flex shrink-0 items-center gap-1 px-2 py-1">
							<JedvSelect
								label={t({ message: "Conversations" })}
								disabled={sending || pending || unavailable}
								value={threadId ?? "new"}
								onValueChange={(value) => {
									setSelection(value);
									setDegraded(null);
								}}
								options={[
									{ value: "new", label: t({ message: "New conversation" }) },
									...(threads.data ?? []).map((thread) => ({
										value: thread.id,
										label: thread.title,
									})),
								]}
								className="flex-1"
							/>
							<JedvIconButton
								label={t({ message: "New conversation" })}
								className="size-6"
								disabled={sending || pending || unavailable}
								onClick={() => {
									setSelection("new");
									setDegraded(null);
								}}
							>
								<LuPlus className="size-3" />
							</JedvIconButton>
						</div>
						<ButlerConversation
							key={`${hostUrl}:${threadId ?? "new"}`}
							messages={history.data ?? []}
							loading={!!threadId && history.isPending}
							disabled={unavailable || sending || pending}
							noKey={ai.data?.configured === false}
							resultReason={degraded}
							onSettings={onSettings}
							onSend={async (humanText, requestId) => {
								if (busy.current) throw new Error("Butler is busy");
								busy.current = true;
								setSending(true);
								try {
									const result = await client.butler.sendMessage.mutate({
										threadId,
										requestId,
										humanText,
									});
									setSelection(result.threadId);
									setDegraded(result.reason);
									await cache.invalidateQueries({
										queryKey: butlerKey(hostUrl),
									});
									return result;
								} finally {
									busy.current = false;
									setSending(false);
								}
							}}
						/>
					</TabsContent>
					<TabsContent value="inbox" className="flex min-h-0 flex-1 flex-col">
						<div className="flex shrink-0 justify-end px-2 py-1">
							<JedvIconButton
								label={
									showHistory
										? t({ message: "Hide history" })
										: t({ message: "Show history" })
								}
								aria-pressed={showHistory}
								className={`size-6 ${showHistory ? "bg-fill-selected" : ""}`}
								disabled={unavailable}
								onClick={() => setShowHistory(!showHistory)}
							>
								<LuHistory className="size-3" />
							</JedvIconButton>
						</div>
						<ButlerInbox
							alerts={alerts}
							approvals={approvals}
							workspaces={context.workspaces}
							teams={teams}
							pending={pending || sending || unavailable}
							blocked={blocked}
							onResolve={(approval, decision) =>
								void resolve(approval, decision)
							}
							onRead={(id) => void read(id)}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</section>
	);
}
