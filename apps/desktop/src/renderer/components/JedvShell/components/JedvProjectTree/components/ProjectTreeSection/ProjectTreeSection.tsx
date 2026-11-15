import { Trans, useLingui } from "@lingui/react/macro";
import type { Project, Workspace } from "../../../../types";
import { supportsWorktrees } from "../../../../vcs-capabilities";
import { JedvProjectRow } from "../../../JedvProjectRow";
import { SortableWorkspaceList } from "../../../JedvWorkspaceRow";
import type { useProjectTreeData } from "../../hooks/useProjectTreeData";
import type { JedvProjectTreeProps } from "../../types";
import {
	matchesTreeFilter,
	projectTreeLanes,
	sameTreeLaneOrder,
	type TreeGroup,
} from "../../utils/tree-layout";
import { ProjectTreeGroupHeader } from "../ProjectTreeGroupHeader";
import { ProjectTreeWorkspace } from "../ProjectTreeWorkspace";
export function ProjectTreeSection({
	props,
	project,
	rows,
	groups,
	data,
	pinnedIds,
	manualOrder,
	pinAvailable,
	pinPending,
	onPin,
	onReorder,
	changed,
	run,
	onEditGroup,
	onMoveGroup,
	onResetGroup,
	onRead,
	onUnread,
	onStopPorts,
	onStopListeners,
	onOpenEditor,
}: {
	props: JedvProjectTreeProps;
	project?: Project;
	rows: Workspace[];
	groups: TreeGroup[];
	data: ReturnType<typeof useProjectTreeData>;
	pinnedIds: Set<string>;
	manualOrder: string[];
	pinAvailable: boolean;
	pinPending: boolean;
	onPin(id: string, pinned: boolean): Promise<void>;
	onReorder(projectId: string | null, ids: string[]): Promise<void>;
	changed(context: JedvProjectTreeProps["context"]): Promise<void>;
	run(work: () => unknown): void;
	onEditGroup(projectId: string, initial?: TreeGroup): void;
	onMoveGroup(
		projectId: string,
		groups: TreeGroup[],
		tag: string,
		direction: -1 | 1,
	): void;
	onResetGroup(projectId: string, tag: string): void;
	onRead(workspaceId: string, lastEvent: number): void;
	onUnread(workspaceId: string): void;
	onStopPorts(workspace: Workspace): void;
	onStopListeners(workspace: Workspace): void;
	onOpenEditor(path: string): void;
}) {
	const { t } = useLingui();
	const context = { ...props.context };
	const scope = project?.id ?? "sessions";
	const name = project?.name ?? t({ message: "Sessions" });
	const collapsedGroups = new Set(props.navigation.collapsedGroups);
	const groupKey = (key: string) =>
		JSON.stringify([context.hostUrl, scope, key]);
	const filtered = !!props.filter.trim();
	const collapsed =
		!filtered &&
		!!project &&
		props.navigation.collapsedProjects.includes(project.id);
	const sort = props.navigation.workspaceSortMode ?? "manual";
	const lanes = projectTreeLanes(rows, groups, {
		sort,
		pinnedIds,
		manualOrder,
	});
	const ids = lanes.flatMap((lane) => lane.workspaces.map((row) => row.id));
	const visible = rows.filter((row) =>
		matchesTreeFilter(name, row, props.filter, groups),
	);
	if (
		filtered &&
		!name.toLowerCase().includes(props.filter.trim().toLowerCase()) &&
		!visible.length
	)
		return null;
	const header = (
		key: string,
		laneName: string,
		count: number,
		group?: TreeGroup,
	) => (
		<ProjectTreeGroupHeader
			name={laneName}
			group={group}
			count={count}
			collapsed={collapsedGroups.has(groupKey(key)) && !filtered}
			disabled={!!props.disabled}
			onToggle={() => {
				const next = new Set(props.navigation.collapsedGroups);
				const serialized = groupKey(key);
				if (next.has(serialized)) next.delete(serialized);
				else next.add(serialized);
				props.navigation.setCollapsedGroups([...next].slice(-128));
			}}
			onEdit={() => onEditGroup(scope, group)}
			canMoveUp={
				!!group && groups.findIndex((row) => row.tag === group.tag) > 0
			}
			canMoveDown={
				!!group &&
				groups.findIndex((row) => row.tag === group.tag) < groups.length - 1
			}
			onMove={(direction) => {
				if (group) onMoveGroup(scope, groups, group.tag, direction);
			}}
			onReset={() => {
				if (group) onResetGroup(scope, group.tag);
			}}
		/>
	);
	return (
		<div
			className="space-y-0.5 [&_[data-tree-group-heading]~button]:top-[30px]"
			data-project-tree-scope={project?.id ?? "sessions"}
		>
			{project ? (
				<JedvProjectRow
					project={project}
					collapsed={collapsed}
					disabled={props.disabled}
					onToggle={() =>
						props.navigation.setCollapsedProjects(
							props.navigation.collapsedProjects.includes(project.id)
								? props.navigation.collapsedProjects.filter(
										(id) => id !== project.id,
									)
								: [...props.navigation.collapsedProjects, project.id].slice(
										-64,
									),
						)
					}
					onNew={() => props.onProjectAction(context, project, "new")}
					onCheckout={() => props.onProjectAction(context, project, "local")}
					onImportWorktrees={
						supportsWorktrees(project)
							? () => props.onProjectAction(context, project, "import")
							: undefined
					}
					onRename={async (value) => {
						await props.onRename(
							context,
							{ kind: "project", id: project.id },
							value,
						);
						await changed(context);
					}}
					onCopy={() => run(() => props.onCopy(context, project.repoPath))}
					onFinder={
						!context.isRemote && props.onOpenFolder
							? () => run(() => props.onOpenFolder?.(context, project.repoPath))
							: undefined
					}
					onOpenEditor={
						!context.isRemote && data.editor.data
							? () => onOpenEditor(project.repoPath)
							: undefined
					}
					onRemove={() => props.onRemoveProject(context, project)}
					onSettings={
						props.onProjectSettings
							? () => props.onProjectSettings?.(context, project)
							: undefined
					}
					onAppearance={
						props.onAppearance
							? () => props.onAppearance?.(context, project)
							: undefined
					}
					onCreateGroup={() => onEditGroup(project.id)}
				/>
			) : (
				<div className="mx-4 flex h-7 items-center justify-between text-xs font-medium">
					<span>{name}</span>
					<button
						type="button"
						disabled={props.disabled}
						className="rounded px-1 text-muted-foreground hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
						onClick={() => onEditGroup(scope)}
					>
						<Trans>New group</Trans>
					</button>
				</div>
			)}
			{!collapsed && (
				<>
					<SortableWorkspaceList
						workspaceIds={ids}
						sortMode={sort}
						filtered={
							filtered ||
							lanes.some(
								(lane) =>
									lane.workspaces.length > 0 &&
									collapsedGroups.has(groupKey(lane.key)),
							)
						}
						available={pinAvailable && !pinPending && !props.disabled}
						onReorder={async (next) => {
							if (!sameTreeLaneOrder(lanes, next))
								throw new Error(
									t({
										message:
											"Use Move to group to move workspaces between groups.",
									}),
								);
							await onReorder(project?.id ?? null, next);
						}}
						renderRow={(id) => {
							const lane = lanes.find((item) =>
								item.workspaces.some((row) => row.id === id),
							);
							const workspace = lane?.workspaces.find((row) => row.id === id);
							if (!lane || !workspace) return null;
							const matches = lane.workspaces.filter((row) =>
								matchesTreeFilter(name, row, props.filter, groups),
							);
							const first = matches[0]?.id === id;
							const visibleRow = matches.some((row) => row.id === id);
							const showHeader = lane.group || lane.pinned || groups.length > 0;
							return (
								<>
									{first && showHeader && (
										<div data-tree-group-heading>
											{header(
												lane.key,
												lane.group?.name ??
													(lane.pinned
														? t({ message: "Pinned" })
														: t({ message: "Ungrouped" })),
												matches.length,
												lane.group ?? undefined,
											)}
										</div>
									)}
									{visibleRow &&
										(filtered || !collapsedGroups.has(groupKey(lane.key))) && (
											<ProjectTreeWorkspace
												workspace={workspace}
												project={project}
												context={context}
												props={props}
												data={data}
												groups={groups}
												pinned={pinnedIds.has(id)}
												pinAvailable={pinAvailable && !pinPending}
												onTogglePin={() => onPin(id, !pinnedIds.has(id))}
												run={run}
												changed={changed}
												onRead={onRead}
												onUnread={onUnread}
												onStopPorts={onStopPorts}
												onStopListeners={onStopListeners}
												onOpenEditor={onOpenEditor}
											/>
										)}
								</>
							);
						}}
					/>
					{!filtered &&
						lanes
							.filter((lane) => lane.group && !lane.workspaces.length)
							.map((lane) => (
								<div key={lane.key}>
									{header(
										lane.key,
										lane.group?.name ?? "",
										0,
										lane.group ?? undefined,
									)}
									{!collapsedGroups.has(groupKey(lane.key)) && (
										<p className="pl-12 py-1 text-[11px] text-muted-foreground">
											<Trans>No workspaces in this group</Trans>
										</p>
									)}
								</div>
							))}
					{visible.length === 0 && (
						<p className="mx-4 py-1 text-xs text-muted-foreground">
							{filtered ? (
								<Trans>No workspaces match your filters</Trans>
							) : (
								<Trans>No workspaces yet</Trans>
							)}
						</p>
					)}
				</>
			)}
		</div>
	);
}
