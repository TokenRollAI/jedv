import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../../types";
import { JedvConfirmDialog } from "../JedvConfirmDialog";
import type { Confirmation } from "../JedvConfirmDialog/JedvConfirmDialog";
import type { ProjectActionContext } from "../JedvProjectActions";
import { redactProjectError } from "../JedvProjectActions/project-utils";
import {
	useWorkspacePresentation,
	WorkspaceGroupDialog,
} from "../JedvWorkspaceRow";
import { ProjectTreeSection } from "./components/ProjectTreeSection";
import { useProjectTreeData } from "./hooks/useProjectTreeData";
import type { JedvProjectTreeProps } from "./types";
import {
	moveTreeGroup,
	openTreeEditor,
	stopTreeWorkspaceForwards,
	stopTreeWorkspaceListeners,
} from "./utils/tree-api";
import {
	matchesTreeFilter,
	projectTreeLanes,
	type TreeGroup,
	treeGroups,
} from "./utils/tree-layout";
import {
	markTreeWorkspaceRead,
	markTreeWorkspaceUnread,
} from "./utils/tree-read-state";

export function JedvProjectTree(props: JedvProjectTreeProps) {
	const { t } = useLingui();
	const context = { ...props.context };
	const latest = useRef(context);
	latest.current = context;
	const data = useProjectTreeData(context, props.workspaces);
	const live = props.workspaces.filter((row) => row.archivedAt == null);
	const presentation = useWorkspacePresentation(context, live);
	const [groupDialog, setGroupDialog] = useState<{
		context: ProjectActionContext;
		projectId: string;
		initial?: TreeGroup;
	} | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const changed = async (target: ProjectActionContext) => {
		await data.changed(target);
		await props.onChanged?.(target);
	};
	const run = (work: () => unknown) => {
		if (busy.current || props.disabled) return;
		busy.current = true;
		setPending(true);
		setError(null);
		void (async () => {
			try {
				await work();
			} catch (failure) {
				setError(
					redactProjectError(
						errorMessage(
							failure,
							t({ message: "Could not update the project tree. Try again." }),
						),
					),
				);
			} finally {
				busy.current = false;
				setPending(false);
			}
		})();
	};
	const stopPorts = (workspace: Workspace) => {
		const target = { ...context };
		const rows =
			data.forwards.data?.filter(
				(row) =>
					row.target.hostUrl === target.hostUrl &&
					row.target.workspaceId === workspace.id,
			) ?? [];
		if (!rows.length) return;
		const ids = rows.map((row) => row.id);
		setConfirmation({
			title: t({ message: "Stop forwarded ports?" }),
			description: t({
				message:
					"This stops only the listed forwarding tunnels. Processes on the target host keep running.",
			}),
			detail: `${target.hostLabel}
${workspace.name || workspace.branch}
${rows.map((row) => row.target.remotePort).join(", ")}`,
			execute: async () => {
				await stopTreeWorkspaceForwards(data.native, target, workspace.id, ids);
				await data.forwards.refetch({ throwOnError: true });
			},
		});
	};
	const stopListeners = (workspace: Workspace) => {
		const target = { ...context };
		const rows =
			data.ports.data
				?.filter((row) => row.workspaceId === workspace.id)
				.map((row) => ({ ...row })) ?? [];
		if (!rows.length) return;
		setConfirmation({
			title: t({ message: "Stop listening processes?" }),
			description: t({
				message:
					"This stops the listed processes on the original host. Terminal work or servers using them can be interrupted. Forwarding tunnels are separate.",
			}),
			detail: `${target.hostLabel}\n${target.hostUrl}\n${workspace.name || workspace.branch}\n${rows.map((row) => `${row.address}:${row.port} · ${row.processName} · PID ${row.pid} · ${row.terminalId}`).join("\n")}`,
			execute: async () => {
				try {
					await stopTreeWorkspaceListeners(target, workspace.id, rows, {
						changed: t({
							message:
								"A listening process changed. Cancel and review the current process list before trying again.",
						}),
						failed: t({
							message:
								"Could not stop a listening process. Earlier successful stops are kept.",
						}),
					});
				} finally {
					await data.ports.refetch({ throwOnError: true });
				}
			},
		});
	};
	const markUnread = (workspaceId: string) => {
		if (
			latest.current.hostUrl === context.hostUrl &&
			latest.current.client === context.client
		)
			markTreeWorkspaceUnread(context.hostUrl, workspaceId);
	};
	const openEditor = (path: string) => {
		const target = { ...context };
		const app = data.editor.data === "auto" ? null : data.editor.data;
		run(() => openTreeEditor(data.native, target, path, app ?? null));
	};
	const onRead = (workspaceId: string, lastEvent: number) => {
		if (
			latest.current.hostUrl === context.hostUrl &&
			latest.current.client === context.client
		)
			markTreeWorkspaceRead(context.hostUrl, workspaceId, lastEvent);
	};
	const edit = (projectId: string, initial?: TreeGroup) =>
		setGroupDialog({ context: { ...context }, projectId, initial });
	const move = (
		projectId: string,
		groups: TreeGroup[],
		tag: string,
		direction: -1 | 1,
	) => {
		const target = { ...context };
		run(async () => {
			try {
				await moveTreeGroup(target, projectId, groups, tag, direction);
			} finally {
				await changed(target);
			}
		});
	};
	const reset = (projectId: string, tag: string) => {
		const target = { ...context };
		run(async () => {
			await target.client.tagFolders.delete.mutate({ scope: projectId, tag });
			await changed(target);
		});
	};
	const common = {
		data,
		pinnedIds: presentation.pinnedIds,
		manualOrder: presentation.manualOrder,
		pinAvailable: presentation.available,
		pinPending: presentation.pending,
		onPin: presentation.setPinned,
		onReorder: presentation.reorder,
		changed,
		run,
		onEditGroup: edit,
		onMoveGroup: move,
		onResetGroup: reset,
		onRead,
		onUnread: markUnread,
		onStopPorts: stopPorts,
		onStopListeners: stopListeners,
		onOpenEditor: openEditor,
	};
	const failures = [
		data.groups.error,
		data.prs.error,
		data.ports.error,
		data.forwards.error,
		data.editor.error,
		presentation.error,
	].filter(Boolean);
	const filtered = !!props.filter.trim();
	const matches = props.projects
		.map((project) => {
			const rows = live.filter((row) => row.projectId === project.id);
			const settings = data.groups.data
				? data.groups.data.filter((row) => row.scope === project.id)
				: (project.tagSettings ?? []);
			return { project, rows, groups: treeGroups(rows, settings) };
		})
		.filter(
			({ project, rows, groups }) =>
				!filtered ||
				project.name
					.toLowerCase()
					.includes(props.filter.trim().toLowerCase()) ||
				rows.some((row) =>
					matchesTreeFilter(project.name, row, props.filter, groups),
				),
		);
	const sessions = live.filter((row) => row.projectId == null);
	const sessionGroups = treeGroups(
		sessions,
		data.groups.data?.filter((row) => row.scope === "sessions") ?? [],
	);
	const showSessions =
		sessions.length > 0 &&
		(!filtered ||
			sessions.some((row) =>
				matchesTreeFilter(
					t({ message: "Sessions" }),
					row,
					props.filter,
					sessionGroups,
				),
			));
	const shortcutOrder = [
		...projectTreeLanes(sessions, sessionGroups, {
			sort: props.navigation.workspaceSortMode,
			pinnedIds: presentation.pinnedIds,
			manualOrder: presentation.manualOrder,
		}).flatMap((lane) => lane.workspaces),
		...matches.flatMap(({ rows, groups }) =>
			projectTreeLanes(rows, groups, {
				sort: props.navigation.workspaceSortMode,
				pinnedIds: presentation.pinnedIds,
				manualOrder: presentation.manualOrder,
			}).flatMap((lane) => lane.workspaces),
		),
	]
		.map((row) => row.id)
		.join("\n");
	useEffect(() => {
		props.onShortcutOrder?.(shortcutOrder ? shortcutOrder.split("\n") : []);
	}, [shortcutOrder, props.onShortcutOrder]);

	return (
		<section className="space-y-1" aria-label={t({ message: "Projects" })}>
			{(error || failures.length > 0) && (
				<div
					role="alert"
					className="mx-4 space-y-1 break-words text-xs text-destructive"
				>
					<p>
						{error ??
							t({
								message:
									"Some project tree actions could not be loaded. Other actions remain available.",
							})}
					</p>
					<Button
						size="sm"
						variant="ghost"
						disabled={pending}
						onClick={() =>
							run(async () => {
								await Promise.all([
									data.groups.refetch({ throwOnError: true }),
									data.prs.refetch(),
									data.ports.refetch(),
									data.forwards.refetch(),
									data.editor.refetch(),
									presentation.query.refetch(),
								]);
							})
						}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			{showSessions && (
				<ProjectTreeSection
					key={`${context.hostUrl}:sessions`}
					props={{
						...props,
						shortcutOrder: shortcutOrder.split("\n"),
						disabled: props.disabled || pending,
					}}
					rows={sessions}
					groups={sessionGroups}
					{...common}
				/>
			)}
			{matches.map(({ project, rows, groups }) => (
				<ProjectTreeSection
					key={`${context.hostUrl}:${project.id}`}
					props={{
						...props,
						shortcutOrder: shortcutOrder.split("\n"),
						disabled: props.disabled || pending,
					}}
					project={project}
					rows={rows}
					groups={groups}
					{...common}
				/>
			))}
			{matches.length === 0 && !showSessions && (
				<p className="mx-4 py-2 text-xs text-muted-foreground">
					{filtered ? (
						<Trans>No projects match your filters</Trans>
					) : (
						<Trans>No projects yet</Trans>
					)}
				</p>
			)}
			{groupDialog && (
				<WorkspaceGroupDialog
					key={`${groupDialog.context.hostUrl}:${groupDialog.projectId}:${groupDialog.initial?.tag ?? "new"}`}
					context={groupDialog.context}
					projectId={groupDialog.projectId}
					initial={groupDialog.initial}
					onChanged={changed}
					onClose={() => setGroupDialog(null)}
				/>
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
