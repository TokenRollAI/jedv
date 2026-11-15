import { getEventBus } from "@jedv/workspace-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { JedvWorkspaceActivityProps } from "../../types";
export function useWorkspaceActivity(
	{ client, hostUrl, workspaceId, getWsToken }: JedvWorkspaceActivityProps,
	_open: boolean,
) {
	const git = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-status"],
		queryFn: () => client.git.getStatus.query({ workspaceId }),
		retry: false,
		refetchInterval: 10000,
	});
	const currentPr = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "activity-current-pr"],
		queryFn: () =>
			client.pullRequests.getByWorkspaces.query({
				workspaceIds: [workspaceId],
			}),
		retry: false,
		refetchInterval: 30000,
	});
	const prs = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "activity-prs"],
		queryFn: () =>
			client.pullRequests.historyByWorkspaces.query({
				workspaceIds: [workspaceId],
			}),
		retry: false,
		refetchInterval: 30000,
	});
	const terminals = useQuery({
		queryKey: ["jedv", hostUrl, "terminals", workspaceId],
		queryFn: () => client.terminal.list.query({ workspaceId }),
		retry: false,
		refetchInterval: 2000,
	});
	useEffect(() => {
		if (!getWsToken) return;
		const bus = getEventBus(hostUrl, getWsToken),
			release = bus.retain();
		bus.watchGit(workspaceId);
		const offGit = bus.on("git:changed", workspaceId, () => void git.refetch());
		const offTerm = bus.on(
			"terminal:lifecycle",
			workspaceId,
			() => void terminals.refetch(),
		);
		return () => {
			offGit();
			offTerm();
			bus.unwatchGit(workspaceId);
			release();
		};
	}, [hostUrl, workspaceId, getWsToken, git.refetch, terminals.refetch]);
	return { git, prs, currentPr, terminals };
}
