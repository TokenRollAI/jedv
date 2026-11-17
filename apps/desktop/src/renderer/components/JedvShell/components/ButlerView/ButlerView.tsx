import type {
	ButlerApprovalShape,
	ButlerTurnContext,
} from "@jedv/shared/butler";
import type {
	AttentionGroupShape,
	AttentionSourceTarget,
} from "@jedv/shared/butler-attention";
import { Badge } from "@jedv/ui/badge";
import { Button } from "@jedv/ui/button";
import { Label } from "@jedv/ui/label";
import { toast } from "@jedv/ui/sonner";
import { Switch } from "@jedv/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@jedv/ui/tabs";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { LuInbox, LuMessageCircle, LuRefreshCw } from "react-icons/lu";
import {
	butlerQueryKey,
	type useButlerInbox,
} from "../../hooks/useButlerInbox";
import { type Team, teamStatusKey, teamworkKey } from "../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../parity-types";
import { ButlerApprovalCard } from "../ButlerDock/components/ButlerApprovalCard";
import { ButlerIcon } from "../ButlerIcon";
import { JedvIconButton } from "../JedvIconButton";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { hasAttentionLocation, openAttentionSource } from "./attention-source";
import { AttentionAutomationSource } from "./components/AttentionAutomationSource";
import { AttentionGroupCard } from "./components/AttentionGroupCard";
import { AttentionMemorySource } from "./components/AttentionMemorySource";
import { ButlerChat } from "./components/ButlerChat";
import { IgnoreAttentionDialog } from "./components/IgnoreAttentionDialog";
import { useAttentionTitle } from "./hooks/useAttentionTitle";
export function ButlerView({
	context,
	index,
	teams,
	connected,
	onSettings,
	onOpenSettings,
	onOpenTeam,
	onOpenAutomations,
}: {
	context: JedvParityViewContext;
	index: ReturnType<typeof useButlerInbox>;
	teams: Team[];
	connected: boolean;
	onSettings(): void;
	onOpenSettings?: () => void;
	onOpenTeam(id: string): void;
	onOpenAutomations(): void;
}) {
	const { t } = useLingui();
	const internalMailSwitchId = useId();
	const { client, hostUrl } = context;
	const key = butlerQueryKey(hostUrl),
		cache = useQueryClient();
	const [diagnostics, setDiagnostics] = useState(false);
	const [tab, setTab] = useState("pending"),
		[chatOpen, setChatOpen] = useState(false),
		[chatMounted, setChatMounted] = useState(false),
		[chatContext, setChatContext] = useState<{
			id: number;
			value?: ButlerTurnContext;
		}>({ id: 0 }),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false),
		[blocked, setBlocked] = useState<Set<string>>(new Set()),
		[ignoring, setIgnoring] = useState<AttentionGroupShape | null>(null),
		[memorySource, setMemorySource] = useState<AttentionSourceTarget | null>(
			null,
		),
		[automationSource, setAutomationSource] =
			useState<AttentionSourceTarget | null>(null);
	const busy = useRef(false);
	const processed = tab === "processed";
	const handled = useQuery({
		queryKey: [...key, "attention", "handled"],
		queryFn: () =>
			client.butler.attention.query({ view: "handled", limit: 100 }),
		enabled: connected && index.attentionSupported && processed,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 15_000,
	});
	const data = processed ? handled.data : index.inbox.data;
	const sourceTeamIds = [
		...new Set(
			data?.groups.flatMap((group) =>
				group.source.teamId ? [group.source.teamId] : [],
			) ?? [],
		),
	].slice(0, 100);
	const sourceTeams = useQueries({
		queries: sourceTeamIds.map((teamId) => ({
			queryKey: teamStatusKey(hostUrl, teamId),
			queryFn: () => client.team.status.query({ teamId }),
			enabled: connected && index.attentionSupported,
			retry: false,
			gcTime: 30_000,
			staleTime: 15_000,
		})),
	});
	const automations = useQuery({
		queryKey: ["jedv", hostUrl, "attention-automation-names"],
		queryFn: () => client.automations.list.query(),
		enabled:
			connected &&
			index.attentionSupported &&
			!!data?.groups.some((group) => !!group.source.automationId),
		retry: false,
		gcTime: 30_000,
		staleTime: 15_000,
	});
	const ignoreTitle = useAttentionTitle(ignoring);

	const failed =
		!connected ||
		index.capabilities.isError ||
		index.inbox.isError ||
		(processed && handled.isError);
	const unavailable = failed || !index.attentionSupported;
	const refresh = async () => {
		setError(false);
		try {
			await index.capabilities.refetch({ throwOnError: true });
			if (index.attentionSupported) {
				await index.inbox.refetch({ throwOnError: true });
				if (processed) await handled.refetch({ throwOnError: true });
			}
			setBlocked(new Set());
		} catch {
			setError(true);
		}
	};
	const run = async (work: () => Promise<unknown>, lockId?: string) => {
		if (busy.current || unavailable || (lockId && blocked.has(lockId)))
			throw new Error("Attention action is unavailable");
		busy.current = true;
		setPending(true);
		setError(false);
		try {
			await work();
			await cache.invalidateQueries({ queryKey: key });
		} catch (cause) {
			if (lockId)
				setBlocked((previous) => new Set([...previous, lockId].slice(-100)));
			setError(true);
			throw cause;
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const resolve = (
		approval: ButlerApprovalShape,
		decision: "approve" | "reject",
	) => {
		if (approval.status !== "pending" || approval.expiresAt <= Date.now())
			return;
		void run(
			() =>
				client.butler.resolveApproval.mutate({
					approvalId: approval.id,
					payloadHash: approval.payloadHash,
					decision,
				}),
			`approval:${approval.id}`,
		).catch(() => {});
	};
	const feed = [
		...(data?.groups ?? [])
			.filter(
				(group) =>
					processed ||
					diagnostics ||
					group.kind !== "mail_unacked" ||
					group.severity === "high",
			)
			.map((group) => ({
				type: "group" as const,
				id: group.groupKey,
				time: group.latestCreatedAt,
				rank: group.severity === "high" ? 1 : 3,
				group,
			})),
		...(data?.approvals ?? []).map((approval) => ({
			type: "approval" as const,
			id: approval.id,
			time: approval.createdAt,
			rank:
				approval.status === "pending" &&
				approval.expiresAt - Date.now() < 120_000
					? 0
					: 2,
			approval,
		})),
	].sort((a, b) => (processed ? 0 : a.rank - b.rank) || b.time - a.time);
	const ask = (value?: ButlerTurnContext) => {
		setChatContext((previous) => ({ id: previous.id + 1, value }));
		setChatMounted(true);
		setChatOpen(true);
	};
	const locate = async (source: AttentionSourceTarget) => {
		if (busy.current || !connected) return;
		busy.current = true;
		setPending(true);
		setError(false);
		try {
			const result = await openAttentionSource(source, context, {
				team: async (id) => {
					await client.team.status.query({ teamId: id });
					await cache.invalidateQueries({
						queryKey: [...teamworkKey(hostUrl), "list"],
					});
					onOpenTeam(id);
				},
				automations: (source) => {
					if (source.automationId) setAutomationSource(source);
					else onOpenAutomations();
				},
				memory: setMemorySource,
			});
			if (result.terminalEnded)
				toast.info(
					t({
						message:
							"The original terminal has ended. Its source is shown instead.",
					}),
				);
		} catch {
			setError(true);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Inbox" })}
		>
			<div className={chatOpen ? "hidden" : "contents"}>
				<WindowChrome primary className="gap-2 border-b border-border pr-3">
					<WindowChromeLeading />
					<WindowChromeControls className="pl-3">
						<h1 className="flex items-center gap-2 text-[13.5px] font-medium">
							<ButlerIcon className="size-4 text-muted-foreground" />
							<Trans>Inbox</Trans>
						</h1>
					</WindowChromeControls>
					<div className="drag min-w-0 flex-1" />
					<WindowChromeControls>
						<JedvIconButton
							label={t({ message: "Refresh" })}
							disabled={pending}
							onClick={() => void refresh()}
						>
							<LuRefreshCw className="size-3.5" />
						</JedvIconButton>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							className="h-7.5 gap-1.5 px-3 text-xs"
							onClick={() => ask()}
						>
							<LuMessageCircle className="size-3.5" />
							<Trans>Ask Butler</Trans>
						</Button>
					</WindowChromeControls>
					<WindowControlsInset />
				</WindowChrome>
			</div>
			<div className="flex min-h-0 flex-1">
				<div
					className={`${chatOpen ? "hidden" : "flex"} min-h-0 min-w-0 flex-1 flex-col p-5`}
				>
					<Tabs
						value={tab}
						onValueChange={setTab}
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
							<TabsList className="h-8 shrink-0">
								<TabsTrigger value="pending" className="text-xs">
									<Trans>Pending</Trans>
									{index.actionable > 0 && (
										<Badge
											title={t({
												message:
													"Pending approvals and unread important faults",
											})}
											variant="secondary"
											className="h-4 min-w-4 px-1 text-[10px]"
										>
											{index.actionable}
										</Badge>
									)}
								</TabsTrigger>
								<TabsTrigger value="processed" className="text-xs">
									<Trans>Processed</Trans>
								</TabsTrigger>
							</TabsList>
							{!processed && (
								<div className="flex items-center gap-2">
									<Switch
										id={internalMailSwitchId}
										checked={diagnostics}
										onCheckedChange={setDiagnostics}
										aria-label={t({ message: "Include internal mail" })}
									/>
									<Label
										htmlFor={internalMailSwitchId}
										className="cursor-pointer text-xs font-normal text-muted-foreground select-none"
									>
										<Trans>Include internal mail</Trans>
									</Label>
								</div>
							)}
						</div>
						{(failed ||
							error ||
							(index.capabilities.isSuccess && !index.attentionSupported)) && (
							<p role="alert" className="py-2 text-xs text-destructive">
								{index.capabilities.isSuccess && !index.attentionSupported
									? t({ message: "Unavailable on this host" })
									: t({ message: "Unavailable" })}
							</p>
						)}
						<TabsContent
							value={tab}
							className="flex min-h-0 flex-1 flex-col overflow-y-auto"
						>
							{index.attentionSupported &&
							(index.inbox.isPending || (processed && handled.isPending)) ? (
								<output className="m-auto block py-12 text-center text-xs text-muted-foreground">
									<Trans>Loading…</Trans>
								</output>
							) : feed.length > 0 ? (
								<div className="mx-auto w-full max-w-4xl space-y-3 py-3">
									{feed.map((item) =>
										item.type === "group" ? (
											<AttentionGroupCard
												key={`group:${item.id}`}
												group={item.group}
												team={teams.find(
													(team) => team.id === item.group.source.teamId,
												)}
												memberName={
													sourceTeams
														.find(
															(query) =>
																query.data?.team.id ===
																item.group.source.teamId,
														)
														?.data?.members.find(
															(member) =>
																member.id === item.group.source.memberId,
														)?.name
												}
												workspaceName={
													context.workspaces.find(
														(workspace) =>
															workspace.id === item.group.source.workspaceId,
													)?.name
												}
												projectName={
													context.projects.find(
														(project) =>
															project.id === item.group.source.projectId,
													)?.name
												}
												automationName={
													automations.data?.find(
														(automation) =>
															automation.id === item.group.source.automationId,
													)?.name
												}
												pending={pending || unavailable}
												blocked={blocked.has(`group:${item.id}`)}
												onRead={() =>
													void run(() =>
														client.butler.markAttentionRead.mutate({
															groupKey: item.id,
														}),
													).catch(() => {})
												}
												onIgnore={() => setIgnoring(item.group)}
												onLocate={
													hasAttentionLocation(item.group.source)
														? () => void locate(item.group.source)
														: undefined
												}
												onAsk={() =>
													ask({
														groupKey: item.group.groupKey,
														...(item.group.source.teamId
															? { teamId: item.group.source.teamId }
															: {}),
														...(item.group.source.workspaceId
															? { workspaceId: item.group.source.workspaceId }
															: {}),
													})
												}
											/>
										) : (
											<div key={`approval:${item.id}`} className="space-y-1">
												<ButlerApprovalCard
													approval={item.approval}
													teams={teams}
													workspaces={context.workspaces}
													pending={pending || unavailable}
													blocked={blocked.has(`approval:${item.id}`)}
													onResolve={(decision) =>
														resolve(item.approval, decision)
													}
												/>
												{item.approval.source &&
													hasAttentionLocation(item.approval.source) && (
														<Button
															type="button"
															variant="ghost"
															size="sm"
															className="h-7 text-xs"
															disabled={pending || unavailable}
															onClick={() => {
																if (item.approval.source)
																	void locate(item.approval.source);
															}}
														>
															<Trans>View source</Trans>
														</Button>
													)}
											</div>
										),
									)}
								</div>
							) : (
								data &&
								!failed && (
									<div className="m-auto flex max-w-sm flex-col items-center gap-2 py-12 text-center">
										<LuInbox className="size-7 text-muted-foreground/70" />
										<p className="text-sm font-medium">
											<Trans>No items</Trans>
										</p>
										{!processed && (
											<p className="text-xs text-muted-foreground">
												<Trans>
													Pending approvals and important team updates will
													appear here.
												</Trans>
											</p>
										)}
									</div>
								)
							)}
						</TabsContent>
					</Tabs>
				</div>
				{chatMounted && (
					<aside
						className={
							chatOpen ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"
						}
						aria-label={t({ message: "Ask Butler" })}
					>
						<ButlerChat
							context={context}
							connected={connected}
							supported={
								index.supported &&
								index.capabilities.data?.features?.conversationState === true
							}
							historyByRequest={
								(
									index.capabilities.data?.features as
										| { historyByRequest?: boolean }
										| undefined
								)?.historyByRequest === true
							}
							active={chatOpen}
							teams={teams}
							actionable={index.actionable}
							pending={pending}
							blocked={blocked}
							askContext={chatContext}
							onResolve={resolve}
							onRefresh={refresh}
							onSettings={onSettings}
							onOpenSettings={onOpenSettings}
							onClose={() => setChatOpen(false)}
						/>
					</aside>
				)}
			</div>
			{ignoring && (
				<IgnoreAttentionDialog
					subject={ignoreTitle}
					onClose={() => setIgnoring(null)}
					onIgnore={(reason) =>
						run(
							() =>
								client.butler.ignoreAttention.mutate({
									groupKey: ignoring.groupKey,
									...(reason ? { reason } : {}),
								}),
							`group:${ignoring.groupKey}`,
						)
					}
				/>
			)}{" "}
			{memorySource && (
				<AttentionMemorySource
					source={memorySource}
					context={context}
					onClose={() => setMemorySource(null)}
				/>
			)}{" "}
			{automationSource && (
				<AttentionAutomationSource
					source={automationSource}
					context={context}
					onClose={() => setAutomationSource(null)}
				/>
			)}
		</section>
	);
}
