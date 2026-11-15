import { presetForAcpHarness } from "@jedv/chat/core";
import { Button } from "@jedv/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	History,
	Loader2,
	MessageSquare,
	RefreshCw,
	TerminalSquare,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { LocalClient } from "../../../../local-client";
import type { HostAgentConfig } from "../../../../types";
import { type ExistingAgentSelection, nativeProvider } from "./types";
import {
	ExistingSessionError,
	resumeExistingCli,
} from "./utils/resume-existing";
import { selectionForBinding } from "./utils/selection";

export function AgentSessionPicker({
	client,
	hostUrl,
	workspaceId,
	configs,
	disabled,
	onLaunch,
	onSelectSession,
	allowLaunch = true,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	configs: HostAgentConfig[];
	disabled: boolean;
	onLaunch?(config: HostAgentConfig): void;
	allowLaunch?: boolean;
	onSelectSession(selection: ExistingAgentSelection): Promise<void>;
}) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [strictUnavailable, setStrictUnavailable] = useState<{
		client: LocalClient;
		hostUrl: string;
		workspaceId: string;
	} | null>(null);
	const strictDisabled =
		strictUnavailable?.client === client &&
		strictUnavailable.hostUrl === hostUrl &&
		strictUnavailable.workspaceId === workspaceId;
	const lock = useRef(false);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const scope = useRef({ client, hostUrl, workspaceId });
	scope.current = { client, hostUrl, workspaceId };
	const bindings = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "native-bindings"],
		queryFn: () => client.terminalAgents.listByWorkspace.query({ workspaceId }),
		enabled: open,
		refetchInterval: open ? 3000 : false,
		retry: false,
	});
	const terminals = useQuery({
		queryKey: ["jedv", hostUrl, "terminals", workspaceId],
		queryFn: () => client.terminal.list.query({ workspaceId }),
		enabled: open,
		refetchInterval: open ? 3000 : false,
		retry: false,
	});
	const chats = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "existing-chat-sessions"],
		queryFn: () => client.sessions.list.query({ workspaceId, limit: 200 }),
		enabled: open,
		retry: false,
	});
	const candidates = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "resume-candidates"],
		queryFn: () =>
			client.terminalAgents.resumeCandidates.query({ workspaceId }),
		enabled: open && allowLaunch,
		retry: false,
	});
	const visibleChats = (chats.data ?? []).filter(
		(chat) => allowLaunch || chat.live,
	);
	const liveCli = (bindings.data ?? []).filter(
		(binding) =>
			!binding.chatSessionId &&
			!binding.endedAt &&
			terminals.data?.sessions.some(
				(row) => row.terminalId === binding.terminalId && !row.exited,
			),
	);
	const current = (original: typeof scope.current) =>
		alive.current &&
		scope.current.client === original.client &&
		scope.current.hostUrl === original.hostUrl &&
		scope.current.workspaceId === original.workspaceId;
	const choose = async (
		key: string,
		action: () => Promise<ExistingAgentSelection | null>,
	) => {
		if (lock.current || disabled) return;
		lock.current = true;
		setPending(key);
		setError(null);
		const original = scope.current;
		try {
			const selection = await action();
			if (selection && current(original)) {
				await onSelectSession(selection);
				setOpen(false);
			}
		} catch (cause) {
			if (
				current(original) &&
				cause instanceof ExistingSessionError &&
				cause.reason === "strict-unavailable"
			)
				setStrictUnavailable(original);
			if (current(original))
				setError(
					cause instanceof ExistingSessionError
						? cause.reason === "unsupported" ||
							cause.reason === "strict-unavailable"
							? t({
									message:
										"Same-session CLI control is unavailable. No new session was started.",
								})
							: cause.reason === "not-resumed"
								? t({
										message:
											"This session could not be resumed. No new session was started.",
									})
								: t({
										message:
											"The resumed session identity could not be verified. Refresh before retrying.",
									})
						: cause instanceof Error
							? cause.message
							: String(cause),
				);
		} finally {
			lock.current = false;
			if (current(original)) setPending(null);
			await cache.invalidateQueries({
				queryKey: ["jedv", original.hostUrl, "terminals", original.workspaceId],
			});
		}
	};
	const title = (id: string) =>
		terminals.data?.sessions.find((row) => row.terminalId === id)?.title;
	return (
		<Popover
			open={open}
			onOpenChange={(value) => {
				if (!pending) setOpen(value);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					className="h-6 max-w-48 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
					aria-label={t({ message: "Choose agent session" })}
				>
					<History className="size-3.5" />
					<Trans>Sessions</Trans>
					<ChevronDown className="size-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg p-0 shadow-lg"
				onKeyDown={(event) => event.stopPropagation()}
			>
				<Command loop label={t({ message: "Choose agent session" })}>
					<CommandInput
						placeholder={t({ message: "Search" })}
						className="h-9 text-xs"
					/>
					<CommandList className="max-h-80 p-1">
						<CommandEmpty>
							<Trans>No results found.</Trans>
						</CommandEmpty>
						{(bindings.isFetching ||
							terminals.isFetching ||
							chats.isFetching ||
							candidates.isFetching) && (
							<output className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
								<Loader2 className="size-3 animate-spin" />
								<Trans>Loading sessions…</Trans>
							</output>
						)}
						{liveCli.length > 0 && (
							<CommandGroup heading={t({ message: "Active CLI sessions" })}>
								{liveCli.map((binding) => (
									<CommandItem
										key={`cli:${binding.terminalId}`}
										value={`cli:${binding.terminalId}`}
										keywords={[
											binding.agentId,
											title(binding.terminalId) ?? "",
											binding.terminalId,
										]}
										disabled={!!pending}
										className="gap-2 py-2 text-xs"
										onSelect={() =>
											void choose(binding.terminalId, async () => {
												const fresh = await client.terminal.list.query({
													workspaceId,
												});
												if (
													!fresh.sessions.some(
														(row) =>
															row.terminalId === binding.terminalId &&
															!row.exited,
													)
												)
													throw new Error(
														t({
															message:
																"This terminal is no longer running. Refresh the session list.",
														}),
													);
												const verified = await client.terminalAgents.get.query({
													workspaceId,
													terminalId: binding.terminalId,
												});
												if (
													!verified ||
													verified.chatSessionId ||
													verified.agentSessionId !== binding.agentSessionId ||
													verified.agentId !== binding.agentId
												)
													throw new Error(
														t({
															message:
																"The session identity changed. Select it again.",
														}),
													);
												return selectionForBinding(verified);
											})
										}
									>
										<AgentIcon
											presetId={binding.agentId}
											className="size-3.5"
										/>
										<span className="min-w-0 flex-1 truncate">
											{title(binding.terminalId) || binding.agentId}
										</span>
										<TerminalSquare className="size-3.5 text-muted-foreground" />
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{allowLaunch &&
							candidates.isSuccess &&
							!!candidates.data?.length && (
								<CommandGroup
									heading={t({ message: "Resume same CLI session" })}
								>
									{candidates.data.map((candidate) => (
										<CommandItem
											key={`resume:${candidate.terminalId}`}
											value={`resume:${candidate.terminalId}`}
											keywords={[candidate.label, candidate.nativeSessionId]}
											disabled={
												!!pending ||
												candidates.isFetching ||
												(strictDisabled &&
													!nativeProvider(candidate.provider)) ||
												!candidate.resumeSupported
											}
											className="gap-2 py-2 text-xs"
											onSelect={() =>
												void choose(candidate.terminalId, async () => {
													return resumeExistingCli(
														client,
														workspaceId,
														candidate,
													);
												})
											}
										>
											<History className="size-3.5" />
											<span className="min-w-0 flex-1 truncate">
												{candidate.label}
											</span>
											<span className="font-mono text-[10px] text-muted-foreground">
												{candidate.nativeSessionId.slice(0, 8)}
											</span>
										</CommandItem>
									))}
								</CommandGroup>
							)}
						{visibleChats.length > 0 && (
							<CommandGroup heading={t({ message: "Existing chat sessions" })}>
								{visibleChats.map((chat) => {
									const provider = nativeProvider(
										presetForAcpHarness(chat.harness) ?? "",
									);
									return (
										<CommandItem
											key={`chat:${chat.sessionId}`}
											value={`chat:${chat.sessionId}`}
											keywords={[
												chat.title ?? "",
												chat.sessionId,
												chat.harness,
											]}
											disabled={!!pending || !provider}
											className="gap-2 py-2 text-xs"
											onSelect={() =>
												void choose(chat.sessionId, async () => {
													const fresh = await client.sessions.get.query({
														workspaceId,
														sessionId: chat.sessionId,
													});
													if (
														!provider ||
														(!allowLaunch && !fresh.live) ||
														fresh.session.sessionId !== chat.sessionId ||
														fresh.session.harness !== chat.harness
													)
														throw new Error(
															t({
																message:
																	"The session identity changed. Select it again.",
															}),
														);
													return {
														source: "chat-session",
														terminalId: null,
														provider,
														chatSessionId: chat.sessionId,
														nativeSessionId: chat.harnessSessionId ?? undefined,
														agentConfigId: chat.agentConfigId ?? undefined,
													};
												})
											}
										>
											<MessageSquare className="size-3.5" />
											<span className="min-w-0 flex-1 truncate">
												{chat.title || chat.harness}
											</span>
											<span className="text-[10px] text-muted-foreground">
												{chat.live ? (
													<Trans>Live</Trans>
												) : (
													<Trans>Read only</Trans>
												)}
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						)}
						{allowLaunch && onLaunch && (
							<CommandGroup heading={t({ message: "Start new session" })}>
								{configs.map((config) => (
									<CommandItem
										key={`new:${config.id}`}
										value={`new:${config.id}`}
										keywords={[config.label, config.presetId]}
										disabled={!!pending || disabled}
										className="gap-2 py-2 text-xs"
										onSelect={() => {
											setOpen(false);
											onLaunch(config);
										}}
									>
										<AgentIcon
											presetId={config.presetId}
											iconId={config.iconId}
											className="size-3.5"
										/>
										<span className="truncate">{config.label}</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
				{allowLaunch && (candidates.error || strictDisabled) && (
					<p className="border-t p-2 text-xs text-muted-foreground">
						<Trans>
							Strict CLI resume is unavailable on this host. Active CLI and chat
							sessions remain selectable.
						</Trans>
					</p>
				)}
				{(error ||
					bindings.error ||
					terminals.error ||
					chats.error ||
					(allowLaunch && candidates.error)) && (
					<p
						role="alert"
						className="max-h-32 overflow-auto whitespace-pre-wrap border-t p-2 text-xs text-destructive"
					>
						{error ||
							bindings.error?.message ||
							terminals.error?.message ||
							chats.error?.message ||
							candidates.error?.message}
					</p>
				)}
				<div className="flex justify-end border-t p-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-6 text-xs"
						disabled={!!pending}
						onClick={() =>
							void Promise.all([
								bindings.refetch(),
								terminals.refetch(),
								chats.refetch(),
								...(allowLaunch ? [candidates.refetch()] : []),
							])
						}
					>
						<RefreshCw className="mr-1 size-3" />
						<Trans>Refresh</Trans>
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
