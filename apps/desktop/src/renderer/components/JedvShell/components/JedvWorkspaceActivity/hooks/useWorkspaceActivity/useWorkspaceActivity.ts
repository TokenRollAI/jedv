import { getEventBus } from "@jedv/workspace-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { JedvWorkspaceActivityProps } from "../../types";
export function useWorkspaceActivity(
	{
		client,
		hostUrl,
		workspaceId,
		getWsToken,
		gitEnabled = true,
		pullRequestsEnabled = true,
	}: JedvWorkspaceActivityProps,
	_open: boolean,
) {
	const git = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-status"],
		queryFn: () => client.git.getStatus.query({ workspaceId }),
		retry: false,
		enabled: gitEnabled,
		refetchInterval: gitEnabled ? 10000 : false,
	});
	const currentPr = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "activity-current-pr"],
		queryFn: () =>
			client.pullRequests.getByWorkspaces.query({
				workspaceIds: [workspaceId],
			}),
		retry: false,
		enabled: pullRequestsEnabled,
		refetchInterval: pullRequestsEnabled ? 30000 : false,
	});
	const prs = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "activity-prs"],
		queryFn: () =>
			client.pullRequests.historyByWorkspaces.query({
				workspaceIds: [workspaceId],
			}),
		retry: false,
		enabled: pullRequestsEnabled,
		refetchInterval: pullRequestsEnabled ? 30000 : false,
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
		if (gitEnabled) bus.watchGit(workspaceId);
		const offGit = gitEnabled ? bus.on("git:changed", workspaceId, () => void git.refetch()) : () => {};
		const offTerm = bus.on(
			"terminal:lifecycle",
			workspaceId,
			() => void terminals.refetch(),
		);
		return () => {
			offGit();
			offTerm();
			if (gitEnabled) bus.unwatchGit(workspaceId);
			release();
		};
	}, [
		hostUrl,
		workspaceId,
		getWsToken,
		gitEnabled,
		git.refetch,
		terminals.refetch,
	]);
	return { git, prs, currentPr, terminals };
}
