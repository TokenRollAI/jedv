import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ProjectActionContext } from "../JedvProjectActions";
import { ActiveWorkspaceSwitcher as ActiveWorkspaceList } from "../JedvWorkspaceRow";
import { activeWorkspaceItems } from "./active-workspaces";
import { ActiveWorkspaceStatusDialog } from "./components/ActiveWorkspaceStatusDialog";
export interface ActiveWorkspaceSwitcherProps {
	context: ProjectActionContext;
	onOpen(result: {
		context: ProjectActionContext;
		workspaceId: string;
	}): Promise<void>;
	onClose(): void;
}
export function ActiveWorkspaceSwitcher({
	context,
	onOpen,
	onClose,
}: ActiveWorkspaceSwitcherProps) {
	const [target] = useState(() => ({ ...context }));
	const workspaces = useQuery({
		queryKey: ["jedv", target.hostUrl, "workspaces"],
		queryFn: () => target.client.workspace.list.query(),
		refetchInterval: 5000,
		retry: false,
	});
	const agents = useQuery({
		queryKey: ["jedv", target.hostUrl, "active-switcher-agents"],
		queryFn: () => target.client.terminalAgents.list.query(),
		refetchInterval: 3000,
		retry: false,
	});
	if (workspaces.isError || agents.isError || !workspaces.data || !agents.data)
		return (
			<ActiveWorkspaceStatusDialog
				failed={workspaces.isError || agents.isError}
				loading={workspaces.isFetching || agents.isFetching}
				hostLabel={target.hostLabel}
				onRetry={() => {
					void workspaces.refetch();
					void agents.refetch();
				}}
				onClose={onClose}
			/>
		);
	return (
		<ActiveWorkspaceList
			context={target}
			items={activeWorkspaceItems(workspaces.data, agents.data)}
			onOpen={onOpen}
			onClose={onClose}
		/>
	);
}
