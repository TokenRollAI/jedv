import { useQuery, useQueryClient } from "@tanstack/react-query";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { Workspace } from "../../../../types";
import { supportsPullRequests } from "../../../../vcs-capabilities";
import type { ProjectActionContext } from "../../../JedvProjectActions";
export function useProjectTreeData(
	context: ProjectActionContext,
	workspaces: Workspace[],
) {
	const native = electronTrpc.useUtils().client;
	const cache = useQueryClient();
	const ids = workspaces
		.filter((row) => row.archivedAt == null)
		.map((row) => row.id)
		.sort();
	const groups = useQuery({
		queryKey: ["jedv", context.hostUrl, "tree-tag-folders"],
		queryFn: () => context.client.tagFolders.list.query(),
		refetchInterval: 5000,
		retry: false,
	});
	const prIds = workspaces
		.filter((row) => row.archivedAt == null && supportsPullRequests(row))
		.map((row) => row.id)
		.sort();
	const prs = useQuery({
		queryKey: ["jedv", context.hostUrl, "tree-prs", prIds],
		queryFn: () =>
			context.client.pullRequests.getByWorkspaces.query({
				workspaceIds: prIds,
			}),
		enabled: prIds.length > 0,
		refetchInterval: 15000,
		retry: false,
	});
	const ports = useQuery({
		queryKey: ["jedv", context.hostUrl, "tree-ports", ids],
		queryFn: () => context.client.ports.getAll.query({ workspaceIds: ids }),
		enabled: ids.length > 0,
		refetchInterval: 3000,
		retry: false,
	});
	const forwards = useQuery({
		queryKey: ["jedv", "tree-port-forwards"],
		queryFn: () => native.portForwards.list.query(),
		refetchInterval: 3000,
		retry: false,
	});
	const editor = useQuery({
		queryKey: ["jedv-settings", "default-editor"],
		queryFn: async () =>
			(await native.settings.getDefaultEditor.query()) ?? "auto",
		retry: false,
	});
	const changed = async (target: ProjectActionContext) => {
		await Promise.all(
			["projects", "workspaces"].map((key) =>
				cache.invalidateQueries(
					{ queryKey: ["jedv", target.hostUrl, key] },
					{ throwOnError: true },
				),
			),
		);
		await Promise.all(
			[
				"bindings",
				"tree-tag-folders",
				"tree-prs",
				"board-workspaces",
				"board-prs",
				"board-agents",
				"active-switcher-agents",
			].map((key) =>
				cache.invalidateQueries({ queryKey: ["jedv", target.hostUrl, key] }),
			),
		);
	};
	return { native, groups, prs, ports, forwards, editor, changed };
}
