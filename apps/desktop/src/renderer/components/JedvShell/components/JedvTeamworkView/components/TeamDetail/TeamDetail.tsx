import { errorMessage } from "@jedv/i18n/errors";
import { Badge } from "@jedv/ui/badge";
import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@jedv/ui/tabs";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
	LuArchive,
	LuCheck,
	LuEllipsis,
	LuPause,
	LuPencil,
	LuPlay,
	LuRefreshCw,
	LuSquare,
	LuTrash2,
	LuUsers,
	LuX,
} from "react-icons/lu";
import {
	type TeamMember,
	teamStatusKey,
	teamworkKey,
} from "../../../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../../../parity-types";
import { DeclarativeDataSlots } from "../../../DeclarativeDataSlots";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { MemoryPanel } from "../../../MemoryPanel";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../../../WindowChrome";
import type { MailDeliveryOptions } from "../../team-mail-drafts";
import { TeamGoal } from "../TeamGoal";
import { TeamIconButton } from "../TeamIconButton";
import { TeamMailComposer } from "../TeamMailComposer";
import { TeamMailTimeline } from "../TeamMailTimeline";
import { TeamMemberGrid } from "../TeamMemberGrid";
export function TeamDetail({
	context,
	teamId,
	connected,
	title,
	deliveryModesSupported = false,
	interruptSupported = false,
	deleteSupported = false,
}: {
	context: JedvParityViewContext;
	teamId: string;
	connected: boolean;
	title: string;
	deliveryModesSupported?: boolean;
	interruptSupported?: boolean;
	deleteSupported?: boolean;
}) {
	const { client, hostUrl } = context;
	const { t } = useLingui();
	const cache = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false),
		[name, setName] = useState("");
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [opening, setOpening] = useState(false);
	const [tab, setTab] = useState("mail");
	const openingRef = useRef(false);
	const status = useQuery({
		queryKey: teamStatusKey(hostUrl, teamId),
		queryFn: () => client.team.status.query({ teamId }),
		enabled: connected,
		refetchInterval: 10_000,
		retry: false,
		gcTime: 30_000,
	});
	const mail = useQuery({
		queryKey: [...teamworkKey(hostUrl), "mail", teamId],
		queryFn: () => client.mail.timeline.query({ teamId, limit: 100 }),
		enabled: connected,
		refetchInterval: 15_000,
		retry: false,
		gcTime: 30_000,
	});
	const team = status.data?.team;
	const members = [...(status.data?.members ?? [])].sort(
		(a, b) =>
			Number(b.role === "leader") - Number(a.role === "leader") ||
			a.joinedAt - b.joinedAt,
	);
	const workspaceIds = [
		...new Set(
			members
				.map((member) => member.workspaceId)
				.filter((id): id is string => !!id),
		),
	];
	const sessions = useQueries({
		queries: workspaceIds.map((workspaceId) => ({
			queryKey: ["jedv", hostUrl, "terminals", workspaceId],
			queryFn: () => client.terminal.list.query({ workspaceId }),
			enabled: connected,
			retry: false,
			refetchInterval: 10_000,
			gcTime: 30_000,
		})),
	});
	const live = new Set(
		sessions
			.filter((query) => !query.isError)
			.flatMap(
				(query) =>
					query.data?.sessions.map((session) => session.terminalId) ?? [],
			),
	);
	const refresh = () =>
		cache.invalidateQueries({ queryKey: teamworkKey(hostUrl) });
	const action = useMutation({
		mutationFn: async (input: {
			kind: "pause" | "resume" | "stop" | "archive" | "rename" | "delete";
			member?: string;
			name?: string;
		}) => {
			if (!connected)
				throw new Error(
					t({
						message:
							"Some team data could not be loaded. Check the host connection and retry.",
					}),
				);
			if (input.kind === "rename")
				await client.team.rename.mutate({ teamId, name: input.name ?? "" });
			else if (input.kind === "stop")
				await client.team.stop.mutate({ teamId, member: input.member });
			else if (input.kind === "delete") {
				if (!deleteSupported)
					throw new Error(t({ message: "Update the host to delete teams." }));
				await client.team.delete.mutate({ teamId });
			} else if (input.kind === "archive")
				await client.team.archive.mutate({ teamId });
			else await client.team[input.kind].mutate({ teamId });
		},
		onMutate: () => setError(null),
		onSuccess: refresh,
		onError: (cause) =>
			setError(errorMessage(cause, t({ message: "Team action failed" }))),
	});
	const consume = useMutation({
		mutationFn: ({ id, ack }: { id: string; ack: boolean }) =>
			client.mail[ack ? "ack" : "read"].mutate({ teamId, deliveryId: id }),
		onMutate: () => setError(null),
		onSuccess: refresh,
		onError: (cause) =>
			setError(errorMessage(cause, t({ message: "Could not update mail" }))),
	});
	const send = useMutation({
		mutationFn: ({
			to,
			body,
			dedupeKey,
			options,
		}: {
			to: string;
			body: string;
			dedupeKey: string;
			options?: MailDeliveryOptions;
		}) => client.mail.send.mutate({ teamId, to, body, dedupeKey, ...options }),
		onMutate: () => setError(null),
		onSuccess: refresh,
		onError: (cause) =>
			setError(
				errorMessage(
					cause,
					t({ message: "Could not send mail. Your draft is kept for retry." }),
				),
			),
	});
	const pending =
		action.isPending || consume.isPending || send.isPending || opening;
	const unavailable = !connected || status.isError || !team;
	const open = async (member: TeamMember) => {
		if (!member.workspaceId || !member.terminalId || openingRef.current) return;
		openingRef.current = true;
		setOpening(true);
		setError(null);
		try {
			const result = await client.terminal.list.query({
				workspaceId: member.workspaceId,
			});
			if (
				!result.sessions.some(
					(session) => session.terminalId === member.terminalId,
				)
			)
				throw new Error(
					t({
						message:
							"This terminal has exited. Refresh the team to see its current status.",
					}),
				);
			await context.onOpenWorkspace(member.workspaceId, member.terminalId);
		} catch (cause) {
			setError(errorMessage(cause, t({ message: "Could not open terminal" })));
		} finally {
			openingRef.current = false;
			setOpening(false);
		}
	};
	const stop = (member?: TeamMember) =>
		setConfirmation({
			title: member
				? t({ message: `Stop ${member.name}?` })
				: t({ message: "Stop this team?" }),
			description: member
				? t({
						message:
							"This stops the worker terminal and may interrupt its work.",
					})
				: t({
						message:
							"This stops all worker terminals and automatic wake-ups. The leader terminal remains open.",
					}),
			detail: `${team?.name ?? teamId}${member ? ` / ${member.name}` : ""}`,
			execute: () => action.mutateAsync({ kind: "stop", member: member?.name }),
		});
	const archive = () =>
		setConfirmation({
			title: t({ message: "Archive this team?" }),
			description: t({
				message:
					"The team becomes read-only. Its workspaces, files and terminals are kept.",
			}),
			detail: team?.name ?? teamId,
			execute: () => action.mutateAsync({ kind: "archive" }),
		});
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-busy={status.isPending}
		>
			<WindowChrome primary className="gap-2 border-b border-border pr-3">
				<WindowChromeLeading />
				<WindowChromeControls className="min-w-0 pl-3">
					<LuUsers className="mr-2 size-4 shrink-0 text-muted-foreground" />
					{editing ? (
						<form
							className="flex min-w-0 items-center gap-1"
							onSubmit={(event) => {
								event.preventDefault();
								if (name.trim())
									void action
										.mutateAsync({ kind: "rename", name: name.trim() })
										.then(() => setEditing(false))
										.catch(() => {});
							}}
						>
							<Input
								autoFocus
								maxLength={120}
								aria-label={t({ message: "Team name" })}
								className="h-7 w-44 text-xs"
								value={name}
								disabled={pending || unavailable}
								onChange={(event) => setName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") setEditing(false);
								}}
							/>
							<TeamIconButton
								label={t({ message: "Save team name" })}
								type="submit"
								disabled={pending || unavailable || !name.trim()}
							>
								<LuCheck className="size-4" />
							</TeamIconButton>
							<TeamIconButton
								label={t({ message: "Cancel" })}
								disabled={pending}
								onClick={() => setEditing(false)}
							>
								<LuX className="size-4" />
							</TeamIconButton>
						</form>
					) : (
						<h1
							className="min-w-0 truncate text-[13px] font-medium"
							title={team?.name ?? title}
						>
							{team?.name ?? title}
						</h1>
					)}
					{team?.status && team.status !== "active" && (
						<Badge variant="secondary" className="ml-2 text-[10px]">
							{team.status === "paused"
								? t({ message: "Paused" })
								: team.status === "archived"
									? t({ message: "Archived team · read-only" })
									: t({ message: "Team stopped" })}
						</Badge>
					)}
				</WindowChromeControls>
				<div className="drag min-w-0 flex-1" />
				<DeclarativeDataSlots
					context={context}
					surface="teamwork.header"
					teamId={teamId}
					connected={connected}
				/>
				<WindowChromeControls>
					<TeamIconButton
						label={t({ message: "Refresh teams" })}
						disabled={pending}
						onClick={() => void refresh()}
					>
						<LuRefreshCw className="size-3.5" />
					</TeamIconButton>
					{(team?.status === "active" || team?.status === "paused") && (
						<TeamIconButton
							label={
								team.status === "paused"
									? t({ message: "Resume automatic wake-ups" })
									: t({ message: "Pause automatic wake-ups" })
							}
							disabled={pending || unavailable}
							onClick={() =>
								action.mutate({
									kind: team.status === "paused" ? "resume" : "pause",
								})
							}
						>
							{team.status === "paused" ? (
								<LuPlay className="size-3.5" />
							) : (
								<LuPause className="size-3.5" />
							)}
						</TeamIconButton>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<TeamIconButton
								label={t({ message: "More options" })}
								disabled={pending || unavailable}
							>
								<LuEllipsis className="size-4" />
							</TeamIconButton>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								disabled={team?.status === "archived"}
								onSelect={() => {
									setName(team?.name ?? "");
									setEditing(true);
								}}
							>
								<LuPencil className="size-3.5" />
								<Trans>Rename team</Trans>
							</DropdownMenuItem>
							{(team?.status === "active" || team?.status === "paused") && (
								<DropdownMenuItem
									onSelect={() => stop()}
									className="text-destructive"
								>
									<LuSquare className="size-3.5" />
									<Trans>Stop team</Trans>
								</DropdownMenuItem>
							)}
							{team?.status === "stopped" && (
								<DropdownMenuItem onSelect={archive}>
									<LuArchive className="size-3.5" />
									<Trans>Archive team</Trans>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								disabled={!deleteSupported}
								onSelect={() =>
									setConfirmation({
										title: t({ message: "Delete this team?" }),
										description: t({
											message:
												"Permanently delete this team, its members, mail, shared team memory and alerts. Team-created agents will be stopped. Existing terminals added to the team, workspaces and files are kept. This cannot be undone.",
										}),
										detail: team?.name ?? teamId,
										execute: () => action.mutateAsync({ kind: "delete" }),
									})
								}
								className="text-destructive"
								title={
									!deleteSupported
										? t({ message: "Update the host to delete teams." })
										: undefined
								}
							>
								<LuTrash2 className="size-3.5" />
								<Trans>Delete team</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</WindowChromeControls>
				<WindowControlsInset />
			</WindowChrome>
			<Tabs
				value={tab}
				onValueChange={setTab}
				className="flex min-h-0 flex-1 flex-col gap-0 px-5 pb-4"
			>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{team && <TeamGoal key={team.id} name={team.name} goal={team.goal} />}
					{(!connected ||
						error ||
						status.isError ||
						mail.isError ||
						sessions.some((query) => query.isError)) && (
						<div
							role="alert"
							className="my-3 flex items-center gap-2 rounded border border-destructive/30 p-2 text-xs text-destructive"
						>
							<span className="min-w-0 flex-1 break-words">
								{error ??
									t({
										message:
											"Some team data could not be loaded. Check the host connection and retry.",
									})}
							</span>
							<Button
								variant="ghost"
								size="sm"
								disabled={pending}
								onClick={() => {
									setError(null);
									void refresh();
									void Promise.all(sessions.map((query) => query.refetch()));
								}}
							>
								<Trans>Retry</Trans>
							</Button>
						</div>
					)}
					{status.isPending ? (
						<output className="block py-8 text-xs text-muted-foreground">
							<Trans>Loading team…</Trans>
						</output>
					) : (
						<div className="py-3">
							<TeamMemberGrid
								members={members}
								projects={context.projects}
								workspaces={context.workspaces}
								live={unavailable ? new Set() : live}
								pending={pending}
								canStop={
									!unavailable &&
									(team?.status === "active" || team?.status === "paused")
								}
								onOpen={(member) => void open(member)}
								onStop={stop}
							/>
						</div>
					)}
					<div className="sticky top-0 z-10 bg-background py-1">
						<TabsList className="h-8">
							<TabsTrigger value="mail" className="text-xs">
								<Trans>Progress and decisions</Trans>
							</TabsTrigger>
							<TabsTrigger value="memory" className="text-xs">
								<Trans>Shared memory</Trans>
							</TabsTrigger>
						</TabsList>
					</div>
					<TabsContent
						value="mail"
						forceMount
						className="data-[state=inactive]:hidden"
					>
						{mail.isPending ? (
							<output className="block py-6 text-xs text-muted-foreground">
								<Trans>Loading mail…</Trans>
							</output>
						) : (
							<TeamMailTimeline
								items={mail.data ?? []}
								members={members}
								pending={pending}
								readOnly={unavailable || team?.status === "archived"}
								onConsume={(id, ack) => consume.mutate({ id, ack })}
							/>
						)}
					</TabsContent>
					<TabsContent value="memory" className="min-h-[420px]">
						<MemoryPanel
							client={client}
							hostUrl={hostUrl}
							disabled={unavailable}
							readOnly={team?.status === "archived"}
							scopes={[
								{
									scopeKind: "team",
									scopeId: teamId,
									label: t({ message: "Team" }),
								},
								...context.projects
									.filter((project) =>
										members.some((member) => member.projectId === project.id),
									)
									.map((project) => ({
										scopeKind: "project" as const,
										scopeId: project.id,
										label: `${t({ message: "Project" })} · ${project.name}`,
									})),
								{
									scopeKind: "global",
									scopeId: "",
									label: t({ message: "Global" }),
								},
							]}
						/>
					</TabsContent>
				</div>
				{team?.status !== "archived" && (
					<div
						className={
							tab === "mail" &&
							!unavailable &&
							(team?.status === "active" || team?.status === "paused")
								? "shrink-0"
								: "hidden"
						}
					>
						<TeamMailComposer
							key={teamId}
							scope={
								context.logicalHostId
									? { hostId: context.logicalHostId, teamId }
									: undefined
							}
							members={members}
							disabled={unavailable || team?.status === "stopped"}
							pending={pending}
							deliveryModesSupported={deliveryModesSupported}
							interruptSupported={interruptSupported}
							onSend={async (to, body, dedupeKey, options) => {
								await send.mutateAsync({ to, body, dedupeKey, options });
							}}
						/>
					</div>
				)}
			</Tabs>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
