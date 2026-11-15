import { Trans } from "@lingui/react/macro";
import { LuFolderOpen } from "react-icons/lu";
export function NonGitState() {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
			<LuFolderOpen className="size-6 text-muted-foreground" />
			<p className="text-sm font-medium">
				<Trans>Plain folder</Trans>
			</p>
			<p className="max-w-sm text-xs text-muted-foreground">
				<Trans>
					Git features are unavailable here. Terminals and files remain
					available.
				</Trans>
			</p>
		</div>
	);
}
