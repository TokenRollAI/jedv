import { parseGitHubRemote } from "@jedv/shared/github-remote";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { Trans, useLingui } from "@lingui/react/macro";
import { FaGithub } from "react-icons/fa";
import { electronTrpcClient } from "renderer/lib/trpc-client";

interface RepositorySectionProps {
	repoUrl: string | null;
}

/**
 * Read-only: the repository URL is derived from the repo's git remote by
 * the host and re-resolved on every import/setup — edit the remote in git
 * to change it.
 */
export function RepositorySection({ repoUrl }: RepositorySectionProps) {
	const { t } = useLingui();

	const parsed = repoUrl ? parseGitHubRemote(repoUrl) : null;

	return (
		<div className="relative w-full max-w-96">
			<Input
				id="project-repo"
				value={repoUrl ?? ""}
				readOnly
				disabled
				placeholder={t({
					message: "No git remote detected",
				})}
				className="w-full font-mono text-sm pr-9"
			/>
			{parsed && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="absolute right-1 top-1 size-7 text-muted-foreground hover:text-foreground"
							onClick={() =>
								void electronTrpcClient.external.openUrl.mutate(parsed.url)
							}
							aria-label={t({
								message: "Open in GitHub",
							})}
						>
							<FaGithub className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<Trans>Open in GitHub</Trans>
					</TooltipContent>
				</Tooltip>
			)}
		</div>
	);
}
