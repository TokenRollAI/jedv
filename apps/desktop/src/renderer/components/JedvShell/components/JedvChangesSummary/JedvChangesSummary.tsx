import { formatNumber } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import {
	LuCircleAlert,
	LuGitBranch,
	LuListTree,
	LuLoaderCircle,
} from "react-icons/lu";
import type { LocalClient } from "../../local-client";

export function JedvChangesSummary({
	client,
	hostUrl,
	workspaceId,
	onOpenChanges,
	active,
}: {
	client: LocalClient;
	active: boolean;
	hostUrl: string;
	workspaceId: string;
	onOpenChanges(): void;
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
			title={
				status.error?.message ??
				data?.currentBranch.name ??
				t({ message: "Changes" })
			}
			onClick={onOpenChanges}
			className="h-7 gap-2 rounded-md border border-border/60 px-2 text-xs font-normal text-muted-foreground"
		>
			{status.isPending ? (
				<LuLoaderCircle className="size-3.5 animate-spin" />
			) : status.error ? (
				<LuCircleAlert className="size-3.5 text-destructive" />
			) : (
				<LuListTree className="size-3.5" />
			)}
			<span className="h-3 border-l border-border" />
			<LuGitBranch className="size-3.5" />
			{data ? (
				<>
					<span className="text-success">+{formatNumber(additions)}</span>
					<span className="text-destructive">−{formatNumber(deletions)}</span>
				</>
			) : (
				<span>{t({ message: "Changes" })}</span>
			)}
		</Button>
	);
}
