import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { GitMissingNotice } from "../GitMissingNotice";
export function GitEnvironmentNotice({ enabled }: { enabled: boolean }) {
	const git = electronTrpc.system.detectGit.useQuery(undefined, {
		enabled,
		retry: false,
		refetchInterval: (query) =>
			query.state.data?.installed === false ? 4000 : false,
	});
	if (!enabled) return null;
	if (git.isError)
		return (
			<div
				role="alert"
				className="rounded border p-3 text-xs text-muted-foreground"
			>
				<Trans>
					Could not check Git on this computer. You can retry or continue.
				</Trans>
				<Button variant="ghost" size="sm" onClick={() => void git.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	return git.data?.installed === false ? (
		<GitMissingNotice
			needsCommandLineTools={git.data.needsCommandLineTools}
			installerRunning={git.data.installerRunning}
			error={git.data.error}
		/>
	) : null;
}
