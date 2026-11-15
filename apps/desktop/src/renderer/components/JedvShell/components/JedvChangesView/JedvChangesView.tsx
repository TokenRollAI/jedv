import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { supportsGit } from "../../vcs-capabilities";
import { NonGitState } from "../NonGitState";
import { GitChangesView } from "./GitChangesView";
export function JedvChangesView(props: ComponentProps<typeof GitChangesView>) {
	const workspace = useQuery({
		queryKey: ["jedv", props.hostUrl, "files-workspace", props.workspaceId],
		queryFn: () => props.client.workspace.get.query({ id: props.workspaceId }),
		enabled: props.active,
		retry: false,
	});
	if (workspace.isError)
		return (
			<div role="alert" className="p-4 text-xs text-destructive">
				{workspace.error.message}
				<Button
					size="sm"
					variant="ghost"
					onClick={() => void workspace.refetch()}
				>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	if (!workspace.data)
		return (
			<output className="p-4 text-xs text-muted-foreground">
				<Trans>Loading…</Trans>
			</output>
		);
	if (!supportsGit(workspace.data)) return <NonGitState />;
	return <GitChangesView {...props} />;
}
