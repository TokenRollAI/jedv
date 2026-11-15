import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { AgentIslandEntry } from "shared/types/agent-island";

export function IslandSessionRow({
	entry,
	busy,
	error,
	onFocus,
	onApprove,
}: {
	entry: AgentIslandEntry;
	busy: boolean;
	error: boolean;
	onFocus(): void;
	onApprove(requestId: string, decision: "accept" | "decline"): void;
}) {
	const { t } = useLingui();
	const status =
		entry.pendingApprovals.length || entry.turnState === "awaiting-approval"
			? t({ message: "Approval required" })
			: entry.turnState === "running"
				? t({ message: "Working" })
				: entry.completedUnread
					? t({ message: "Turn finished" })
					: entry.turnState === "idle"
						? t({ message: "Idle" })
						: t({ message: "Status unavailable" });
	const canApprove =
		entry.activeWriter === "control" &&
		!!entry.nativeSessionId &&
		!!entry.profileHash;
	return (
		<li className="border-t border-border/60 first:border-0">
			<button
				type="button"
				onClick={onFocus}
				className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
			>
				<AgentIcon presetId={entry.provider} className="size-4" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-xs font-medium">
						{entry.workspaceName}
					</span>
					<span className="block truncate text-[10px] text-muted-foreground">
						{entry.projectName}
					</span>
				</span>
				<span
					className={`text-[10px] ${entry.pendingApprovals.length ? "text-warning" : "text-muted-foreground"}`}
				>
					{status}
				</span>
			</button>
			{entry.summary && (
				<p className="px-2 pb-1 text-xs text-muted-foreground">
					{entry.summary}
				</p>
			)}
			{entry.pendingApprovals.slice(0, 1).map((approval) => (
				<div key={approval.requestId} className="space-y-1 px-2 pb-2">
					<p className="text-xs">
						{approval.method.includes("command") ? (
							<Trans>Command needs approval</Trans>
						) : approval.method.includes("fileChange") ? (
							<Trans>File change needs approval</Trans>
						) : (
							<Trans>Approval requested</Trans>
						)}
					</p>
					{canApprove ? (
						<div className="flex gap-1">
							<Button
								size="sm"
								variant="secondary"
								className="h-6 flex-1 text-xs"
								disabled={busy || error}
								onClick={() => onApprove(approval.requestId, "accept")}
							>
								<Trans>Accept</Trans>
							</Button>
							<Button
								size="sm"
								variant="outline"
								className="h-6 flex-1 text-xs"
								disabled={busy || error}
								onClick={() => onApprove(approval.requestId, "decline")}
							>
								<Trans>Decline</Trans>
							</Button>
						</div>
					) : (
						<Button
							size="sm"
							variant="outline"
							className="h-6 w-full text-xs"
							onClick={onFocus}
						>
							{entry.terminalId ? (
								<Trans>Handle in terminal</Trans>
							) : (
								<Trans>Open session</Trans>
							)}
						</Button>
					)}
					<details className="text-[10px] text-muted-foreground">
						<summary className="cursor-pointer">
							<Trans>Details</Trans>
						</summary>
						<p className="break-all">{approval.method}</p>
						<p className="break-all">{approval.requestId}</p>
					</details>
				</div>
			))}
			{error && (
				<div className="px-2 pb-2 text-xs text-destructive" role="alert">
					<Trans>
						Approval failed. Open the workspace to inspect its current state.
					</Trans>
					<button type="button" onClick={onFocus} className="ml-1 underline">
						<Trans>Open</Trans>
					</button>
				</div>
			)}
		</li>
	);
}
