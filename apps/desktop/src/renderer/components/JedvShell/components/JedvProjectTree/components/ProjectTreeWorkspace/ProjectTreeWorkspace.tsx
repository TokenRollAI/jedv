import {
	agentStatusFromEvent,
	highestAgentStatus,
} from "@jedv/shared/agent-status";
import { useLingui } from "@lingui/react/macro";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { Project, Workspace } from "../../../../types";
import { PullRequestStateIcon } from "../../../JedvPullRequestsView/components/PullRequestStateIcon";
import { JedvWorkspaceRow } from "../../../JedvWorkspaceRow";
import {
	useWorkspaceReadReceipts,
	workspaceReadThrough,
} from "../../../JedvWorkspacesBoard/stores/read-receipts";
import { TeamworkBadge } from "../../../TeamworkBadge";
import { WorkspaceForwards } from "../../../WorkspaceForwards";
import type { useProjectTreeData } from "../../hooks/useProjectTreeData";
import type { JedvProjectTreeProps } from "../../types";
import type { TreeGroup } from "../../utils/tree-layout";
export function ProjectTreeWorkspace({
	workspace,
	project,
	context,
	props,
	data,
	groups,
	pinned,
	pinAvailable,
	onTogglePin,
	run,
	changed,
	onRead,
	onUnread,
	onStopPorts,
	onStopListeners,
	onOpenEditor,
}: {
	workspace: Workspace;
	project?: Project;
	context: JedvProjectTreeProps["context"];
	props: JedvProjectTreeProps;
	data: ReturnType<typeof useProjectTreeData>;
	groups: TreeGroup[];
	pinned: boolean;
	pinAvailable: boolean;
	onTogglePin(): Promise<void>;
	run(work: () => unknown): void;
	changed(context: JedvProjectTreeProps["context"]): Promise<void>;
	onRead(workspaceId: string, lastEvent: number): void;
	onUnread(workspaceId: string): void;
	onStopPorts(workspace: Workspace): void;
	onStopListeners(workspace: Workspace): void;
	onOpenEditor(path: string): void;
}) {
	const { t } = useLingui();
	const bindings = props.bindings.filter(
		(binding) =>
			binding.workspaceId === workspace.id && binding.endedAt == null,
	);
	const status = highestAgentStatus(
		bindings.map((binding) => agentStatusFromEvent(binding.lastEventType)),
	);
	const events = {
		working: "Start",
		permission: "PermissionRequest",
		failed: "Failed",
		review: "Stop",
	};
	const lastEvent = Math.max(
		0,
		...bindings.map((binding) => binding.lastEventAt),
	);
	const receipts = useWorkspaceReadReceipts((state) => state.receipts);
	const readThrough = workspaceReadThrough(
		receipts,
		context.hostUrl,
		workspace.id,
	);
	const unread =
		readThrough < 0 || (status === "review" && readThrough < lastEvent);
	const forwards =
		data.forwards.data?.filter(
			(row) =>
				row.target.hostUrl === context.hostUrl &&
				row.target.workspaceId === workspace.id,
		) ?? [];
	const ports = [
		...new Set([
			...(data.ports.data
				?.filter((row) => row.workspaceId === workspace.id)
				.map((row) => row.port) ?? []),
			...forwards.map((row) => row.target.remotePort),
		]),
	];
	const path =
		workspace.worktreePath ??
		(workspace.type === "local" ? project?.repoPath : undefined);
	const pr = data.prs.data?.workspaces.find(
		(row) => row.workspaceId === workspace.id,
	)?.pullRequest;
	return (
		<JedvWorkspaceRow
			workspace={workspace}
			context={context}
			groups={groups}
			active={props.activeWorkspaceId === workspace.id}
			agentStatus={status ? events[status] : undefined}
			unread={unread}
			pinned={pinned}
			ports={ports}
			hasPullRequest={!!pr}
			shortcutIndex={props.shortcutOrder?.indexOf(workspace.id) ?? -1}
			statusActions={
				<>
					{pr && (
						<button
							type="button"
							aria-label={t({ message: `Open pull request #${pr.number}` })}
							title={`#${pr.number} ${pr.title}`}
							className="grid size-[18px] place-items-center rounded hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
							disabled={
								!project?.repoOwner || !project.repoName || props.disabled
							}
							onClick={() => {
								if (project?.repoOwner && project.repoName)
									props.onOpenPullRequest?.(context, {
										projectId: project.id,
										owner: project.repoOwner,
										repo: project.repoName,
										number: pr.number,
										title: pr.title,
									});
							}}
						>
							<PullRequestStateIcon
								state={pr.state}
								draft={pr.state === "draft"}
							/>
						</button>
					)}
					{ports.length > 0 && (
						<WorkspaceForwards
							inline
							client={context.client}
							hostUrl={context.hostUrl}
							workspaceId={workspace.id}
							remote={context.isRemote}
							portsSnapshot={data.ports.data?.filter(
								(port) => port.workspaceId === workspace.id,
							)}
							onOpenUrl={(url) =>
								props.onOpenPort?.(context, workspace.id, url) ??
								Promise.resolve()
							}
						/>
					)}
				</>
			}
			agentChips={
				bindings.length > 0 || props.workspaceTeams?.has(workspace.id) ? (
					<div className="ml-10 mr-3 flex items-start gap-1 py-0.5">
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
							{bindings.map((binding) => (
								<button
									type="button"
									key={binding.terminalId}
									title={`${binding.agentId} · ${binding.lastEventType ?? ""}`}
									aria-label={t({ message: `Open ${binding.agentId} session` })}
									className="flex h-5 items-center gap-1 rounded px-1 text-[10px] text-muted-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
									onClick={() => {
										void props.onOpenWorkspace(
											context,
											workspace.id,
											binding.terminalId,
										);
									}}
								>
									<AgentIcon presetId={binding.agentId} className="size-3" />
									<span>{binding.agentId}</span>
								</button>
							))}
						</div>
						{props.onOpenTeam && (
							<TeamworkBadge
								teams={props.workspaceTeams?.get(workspace.id) ?? []}
								onSelect={props.onOpenTeam}
							/>
						)}
					</div>
				) : undefined
			}
			disabled={props.disabled}
			onChanged={changed}
			onSelect={() =>
				run(async () => {
					await props.onOpenWorkspace(context, workspace.id);
					onRead(workspace.id, lastEvent);
				})
			}
			onNewTerminal={() =>
				run(() => props.onCreateTerminal(context, workspace.id))
			}
			onLaunch={(provider) =>
				run(() => props.onLaunch(context, provider, workspace.id))
			}
			onRename={async (name) => {
				await props.onRename(
					context,
					{ kind: "workspace", id: workspace.id },
					name,
				);
				await changed(context);
			}}
			onCopy={(value) => run(() => props.onCopy(context, value))}
			onFinder={
				!context.isRemote && path && props.onOpenFolder
					? () => run(() => props.onOpenFolder?.(context, path))
					: undefined
			}
			onDelete={() => props.onDeleteWorkspace(context, workspace)}
			onTogglePin={pinAvailable ? () => run(onTogglePin) : undefined}
			onMarkRead={unread ? () => onRead(workspace.id, lastEvent) : undefined}
			onMarkUnread={!unread ? () => onUnread(workspace.id) : undefined}
			onCloseListeningPorts={
				data.ports.isSuccess &&
				data.ports.data.some((row) => row.workspaceId === workspace.id)
					? () => onStopListeners(workspace)
					: undefined
			}
			onClosePorts={
				data.forwards.isSuccess && forwards.length
					? () => onStopPorts(workspace)
					: undefined
			}
			onOpenEditor={
				!context.isRemote && path && data.editor.isSuccess
					? () => onOpenEditor(path)
					: undefined
			}
		/>
	);
}
