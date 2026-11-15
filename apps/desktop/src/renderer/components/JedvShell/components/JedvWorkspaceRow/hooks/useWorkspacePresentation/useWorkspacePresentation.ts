import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Workspace } from "../../../../types";
import type { ProjectActionContext } from "../../../JedvProjectActions";
export function orderedWorkspaceIds(
	workspaces: readonly Pick<Workspace, "id">[],
	presentation: readonly { workspaceId: string; position: number | null }[],
) {
	const positions = new Map(
		presentation.map((row) => [row.workspaceId, row.position]),
	);
	return workspaces
		.map((row, index) => ({
			id: row.id,
			index,
			position: positions.get(row.id) ?? Number.MAX_SAFE_INTEGER,
		}))
		.sort((a, b) => a.position - b.position || a.index - b.index)
		.map((row) => row.id);
}
export function moveWorkspaceInScope(
	all: readonly string[],
	workspaceId: string,
	direction: -1 | 1,
): string[] {
	const result = [...all];
	const index = result.indexOf(workspaceId);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= result.length) return result;
	const current = result[index];
	const next = result[target];
	if (current === undefined || next === undefined) return result;
	result[index] = next;
	result[target] = current;
	return result;
}
export function useWorkspacePresentation(
	context: ProjectActionContext | null,
	workspaces: Workspace[],
) {
	const queries = useQueryClient();
	const { t } = useLingui();
	const key = ["jedv", context?.hostUrl, "workspace-presentation"];
	const query = useQuery({
		queryKey: key,
		queryFn: () => {
			if (!context)
				throw new Error(
					t({
						message:
							"Connect to a host before changing workspace presentation.",
					}),
				);
			return context.client.settings.workspacePresentation.list.query();
		},
		enabled: !!context,
		retry: false,
	});
	const pinnedIds = useMemo(
		() =>
			new Set(
				query.data?.filter((row) => row.pinned).map((row) => row.workspaceId) ??
					[],
			),
		[query.data],
	);
	const manualOrder = useMemo(
		() => orderedWorkspaceIds(workspaces, query.data ?? []),
		[workspaces, query.data],
	);
	const mutation = useMutation({
		mutationFn: async (
			action:
				| {
						context: ProjectActionContext;
						kind: "pin";
						workspaceId: string;
						pinned: boolean;
				  }
				| {
						context: ProjectActionContext;
						kind: "reorder";
						projectId: string | null;
						workspaceIds: string[];
				  },
		) => {
			if (!context || !query.isSuccess)
				throw new Error(
					t({
						message:
							"Workspace pinning and ordering are unavailable on this host.",
					}),
				);
			const target = action.context;
			if (action.kind === "pin")
				await target.client.settings.workspacePresentation.setPinned.mutate({
					workspaceId: action.workspaceId,
					pinned: action.pinned,
				});
			else {
				const live = await target.client.workspace.list.query();
				const scope = live
					.filter((row) => row.projectId === action.projectId)
					.map((row) => row.id);
				if (
					scope.length !== action.workspaceIds.length ||
					new Set(action.workspaceIds).size !== scope.length ||
					scope.some((id) => !action.workspaceIds.includes(id))
				) {
					await queries.invalidateQueries({
						queryKey: ["jedv", target.hostUrl, "workspaces"],
					});
					throw new Error(
						t({
							message:
								"The workspace list changed on the host. Refresh it before reordering.",
						}),
					);
				}
				await target.client.settings.workspacePresentation.reorder.mutate({
					projectId: action.projectId,
					workspaceIds: action.workspaceIds,
				});
			}
		},
		onError: (error, action) => {
			if ((error as { data?: { code?: string } }).data?.code === "CONFLICT")
				void queries.invalidateQueries({
					queryKey: ["jedv", action.context.hostUrl, "workspaces"],
				});
		},
		onSettled: (_result, _error, action) =>
			queries.invalidateQueries({
				queryKey: ["jedv", action.context.hostUrl, "workspace-presentation"],
			}),
	});
	return {
		query,
		pinnedIds,
		manualOrder,
		pending: mutation.isPending,
		error: mutation.error,
		available: query.isSuccess,
		setPinned: (workspaceId: string, pinned: boolean) =>
			context
				? mutation.mutateAsync({
						context: { ...context },
						kind: "pin",
						workspaceId,
						pinned,
					})
				: Promise.reject(
						new Error(
							t({
								message:
									"Connect to a host before changing workspace presentation.",
							}),
						),
					),
		reorder: (projectId: string | null, workspaceIds: string[]) =>
			context
				? mutation.mutateAsync({
						context: { ...context },
						kind: "reorder",
						projectId,
						workspaceIds,
					})
				: Promise.reject(
						new Error(
							t({
								message:
									"Connect to a host before changing workspace presentation.",
							}),
						),
					),
	};
}
