import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LuCheck, LuRefreshCw } from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import { teamworkKey, type useTeamwork } from "../../../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../../../parity-types";
import { JedvIconButton } from "../../../JedvIconButton";
import { eligibleTeamLeaders } from "../../candidates";
import { taskTeamName } from "../../task-name";
export function ExistingTeamSessionDialog({
	context,
	index,
	connected,
	name,
	goal,
	onCreated,
	onClose,
}: {
	context: JedvParityViewContext;
	index: ReturnType<typeof useTeamwork>;
	connected: boolean;
	name: string;
	goal: string;
	onCreated(id: string): void;
	onClose(): void;
}) {
	const { t } = useLingui();
	const { client, hostUrl } = context;
	const cache = useQueryClient();
	const [selected, setSelected] = useState("");
	const [pending, setPending] = useState(false),
		[error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const bindings = useQuery({
		queryKey: ["jedv", hostUrl, "team-leaders"],
		queryFn: () => client.terminalAgents.list.query(),
		enabled: connected && index.supported,
		retry: false,
		refetchInterval: 5_000,
		gcTime: 30_000,
	});
	const workspaceIds = [
		...new Set(
			bindings.data
				?.filter(
					(binding) =>
						binding.endedAt == null &&
						!binding.chatSessionId &&
						binding.launchId &&
						binding.agentSessionId,
				)
				.map((binding) => binding.workspaceId) ?? [],
		),
	];
	const sessions = useQueries({
		queries: workspaceIds.map((workspaceId) => ({
			queryKey: ["jedv", hostUrl, "terminals", workspaceId],
			queryFn: () => client.terminal.list.query({ workspaceId }),
			enabled: connected && index.supported,
			retry: false,
			refetchInterval: 5_000,
			gcTime: 30_000,
		})),
	});
	const ready =
		connected &&
		index.membershipReady &&
		bindings.isSuccess &&
		!bindings.isError &&
		sessions.every((query) => query.isSuccess && !query.isError);
	const live = new Map(
		workspaceIds.map((id, i) => [
			id,
			sessions[i]?.isError ? [] : (sessions[i]?.data?.sessions ?? []),
		]),
	);
	const candidates = ready
		? eligibleTeamLeaders(
				bindings.data ?? [],
				live,
				index.activeSnapshots,
				context.workspaces,
			)
		: [];
	const chosen = candidates.find((candidate) => candidate.id === selected);
	const refresh = async () => {
		await Promise.all([
			cache.invalidateQueries({ queryKey: teamworkKey(hostUrl) }),
			bindings.refetch(),
			...sessions.map((query) => query.refetch()),
		]);
	};
	const submit = async () => {
		if (busy.current || !ready || !chosen) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			const [freshBindings, freshTeams, freshWorkspaces, terminalSessions] =
				await Promise.all([
					client.terminalAgents.list.query(),
					client.team.list.query({ status: "active" }),
					client.workspace.list.query(),
					client.terminal.list.query({
						workspaceId: chosen.binding.workspaceId,
					}),
				]);
			const memberships = await Promise.all(
				freshTeams.map((team) => client.team.status.query({ teamId: team.id })),
			);
			const valid = eligibleTeamLeaders(
				freshBindings,
				new Map([[chosen.binding.workspaceId, terminalSessions.sessions]]),
				memberships,
				freshWorkspaces,
			).find((candidate) => candidate.id === chosen.id);
			if (!valid) {
				await refresh();
				throw new Error(
					t({
						message:
							"This agent is no longer available. Choose another leader.",
					}),
				);
			}
			const result = await client.team.init.mutate({
				actor: {
					workspaceId: valid.binding.workspaceId,
					terminalId: valid.binding.terminalId,
					launchId: valid.binding.launchId ?? undefined,
				},
				name: taskTeamName(
					goal,
					name,
					valid.session.customTitle ||
						valid.session.title ||
						valid.binding.agentId,
				),
				goal,
			});
			await cache.invalidateQueries({ queryKey: teamworkKey(hostUrl) });
			onCreated(result.team.id);
		} catch (cause) {
			setError(
				errorMessage(
					cause,
					t({
						message: "Could not create team. Refresh the agents and retry.",
					}),
				),
			);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!pending}
				onInteractOutside={(e) => {
					if (pending) e.preventDefault();
				}}
				onEscapeKeyDown={(e) => {
					if (pending) e.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Use an existing session</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Choose a running agent as leader to start collaborating.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center justify-end">
					<JedvIconButton
						label={t({ message: "Refresh agents" })}
						disabled={pending || !connected}
						onClick={() => void refresh()}
					>
						<LuRefreshCw className="size-3.5" />
					</JedvIconButton>
				</div>
				<Command>
					<CommandInput
						placeholder={t({ message: "Search agents…" })}
						disabled={pending}
					/>
					<CommandList className="max-h-64">
						{!ready ? (
							<output className="block p-3 text-xs text-muted-foreground">
								{!connected ||
								bindings.isError ||
								sessions.some((q) => q.isError) ||
								index.membershipError ||
								index.capabilities.isError
									? t({
											message:
												"Could not create team. Refresh the agents and retry.",
										})
									: t({ message: "Loading agents…" })}
							</output>
						) : (
							<>
								<CommandEmpty>
									<Trans>
										Start an agent in a workspace, then create a team.
									</Trans>
								</CommandEmpty>
								{candidates.map((candidate) => {
									const title =
										candidate.session.customTitle ||
										candidate.session.title ||
										`#${candidate.binding.terminalId.slice(0, 8)}`;
									const project =
										context.projects.find(
											(p) => p.id === candidate.workspace.projectId,
										)?.name ?? t({ message: "Session" });
									return (
										<CommandItem
											key={candidate.id}
											value={candidate.id}
											keywords={[
												title,
												candidate.binding.agentId,
												project,
												candidate.workspace.name || candidate.workspace.branch,
											]}
											disabled={pending}
											onSelect={() => setSelected(candidate.id)}
											className="gap-2"
										>
											<AgentIcon
												presetId={candidate.binding.agentId}
												className="size-5"
											/>
											<span
												className="min-w-0 flex-1"
												title={`${candidate.binding.workspaceId} · ${candidate.binding.terminalId}`}
											>
												<span className="block truncate text-xs">{title}</span>
												<span className="block truncate text-[11px] text-muted-foreground">
													{project} /{" "}
													{candidate.workspace.name ||
														candidate.workspace.branch}
												</span>
											</span>
											{selected === candidate.id && (
												<LuCheck className="size-4" />
											)}
										</CommandItem>
									);
								})}
							</>
						)}
					</CommandList>
				</Command>
				{ready && !candidates.length && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => {
							onClose();
							context.onOpenCreateWorkspace();
						}}
					>
						<Trans>New Workspace</Trans>
					</Button>
				)}
				{error && (
					<p role="alert" className="break-words text-xs text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						onClick={onClose}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={pending || !ready || !chosen}
						onClick={() => void submit()}
					>
						<Trans>Create team</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
