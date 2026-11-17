import { formatNumber } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { cn } from "@jedv/ui/utils";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { LuCircleAlert, LuGitBranch, LuLoaderCircle } from "react-icons/lu";
import type { LocalClient } from "../../local-client";

export function JedvChangesSummary({
	client,
	hostUrl,
	workspaceId,
	onOpenChanges,
	active,
	isOpen = false,
}: {
	client: LocalClient;
	active: boolean;
	hostUrl: string;
	workspaceId: string;
	onOpenChanges(): void;
	isOpen?: boolean;
}) {
	const { t } = useLingui();
	const status = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-status"],
		queryFn: () =>
			client.git.getStatus.query({ workspaceId, priority: "background" }),
		enabled: active,
		refetchInterval: active ? 10_000 : false,
		retry: false,
	});
	const data = status.data;
	const files = [
		...new Map(
			[
				...(data?.againstBase ?? []),
				...(data?.staged ?? []),
				...(data?.unstaged ?? []),
			].map((file) => [file.path, file]),
		).values(),
	];
	const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
	const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
	return (
		<Button
			size="sm"
			variant="ghost"
			aria-label={t({ message: "Changes" })}
			aria-pressed={isOpen}
			title={
				status.error?.message ??
				data?.currentBranch.name ??
				t({ message: "Changes" })
			}
			onClick={onOpenChanges}
			className={cn(
				"no-drag h-7 gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
				isOpen
					? "border-border bg-card text-foreground shadow-2xs hover:bg-accent/60"
					: "border-border/70 bg-card/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
			)}
		>
			{status.isPending ? (
				<LuLoaderCircle className="size-3.5 animate-spin" />
			) : status.error ? (
				<LuCircleAlert className="size-3.5 text-destructive" />
			) : (
				<LuGitBranch className="size-3.5" />
			)}
			{data ? (
				<>
					<span className="tabular-nums text-success">
						+{formatNumber(additions)}
					</span>
					<span className="tabular-nums text-destructive">
						−{formatNumber(deletions)}
					</span>
				</>
			) : (
				<span>{t({ message: "Changes" })}</span>
			)}
		</Button>
	);
}
