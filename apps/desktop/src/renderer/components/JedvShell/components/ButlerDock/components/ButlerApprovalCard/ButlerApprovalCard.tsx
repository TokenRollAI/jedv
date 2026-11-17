import { formatDateTime } from "@jedv/i18n/format";
import type { ButlerApprovalShape } from "@jedv/shared/butler";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuShieldQuestion } from "react-icons/lu";
import type { Team } from "../../../../hooks/useTeamwork";
import type { Workspace } from "../../../../types";
export function ButlerApprovalCard({
	approval,
	workspaces,
	teams,
	pending,
	blocked,
	onResolve,
}: {
	approval: ButlerApprovalShape;
	workspaces: Workspace[];
	teams: Team[];
	pending: boolean;
	blocked: boolean;
	onResolve(decision: "approve" | "reject"): void;
}) {
	const { t } = useLingui();
	const payload = approval.payload;
	const title =
		payload.actionType === "stopTeam"
			? t({ message: "Stop Team" })
			: payload.actionType === "archiveWorkspace"
				? t({ message: "Archive Workspace" })
				: payload.actionType === "deleteMemoryBatch"
					? t({ message: "Remove memories" })
					: t({ message: "Accept global memory" });
	const target =
		payload.actionType === "stopTeam"
			? teams.find((team) => team.id === payload.teamId)?.name
			: payload.actionType === "archiveWorkspace"
				? workspaces.find((workspace) => workspace.id === payload.workspaceId)
						?.name
				: undefined;
	const count =
		payload.actionType === "deleteMemoryBatch" ? payload.memoryIds.length : 0;
	const expired =
		approval.status === "expired" ||
		(approval.status === "pending" && approval.expiresAt <= Date.now());
	const enabled =
		approval.status === "pending" && !expired && !blocked && !pending;
	const time = formatDateTime(approval.expiresAt);
	const label =
		approval.status === "executed"
			? t({ message: "Executed" })
			: approval.status === "rejected"
				? t({ message: "Rejected" })
				: approval.status === "failed"
					? t({ message: "Failed" })
					: expired
						? t({ message: "Expired" })
						: approval.status === "claimed"
							? t({ message: "Processing" })
							: t({ message: "Pending" });
	const confirm =
		payload.actionType === "stopTeam"
			? t({ message: "Confirm stop" })
			: payload.actionType === "archiveWorkspace"
				? t({ message: "Confirm archive" })
				: payload.actionType === "deleteMemoryBatch"
					? t({ message: "Confirm memory removal" })
					: t({ message: "Confirm global memory adoption" });
	return (
		<article className="space-y-2 rounded-lg border border-border bg-card p-2.5">
			<h3 className="flex items-center gap-1.5 text-xs font-medium">
				<LuShieldQuestion className="size-3.5 shrink-0 text-warning" />
				{title}
				<span className="ml-auto text-[10px] font-normal text-muted-foreground">
					{label}
				</span>
			</h3>
			{target && (
				<p className="truncate text-xs text-foreground/80" title={target}>
					{target}
					{payload.actionType === "stopTeam" && payload.member && (
						<>
							{" "}
							· <Trans>Member</Trans>
						</>
					)}
				</p>
			)}
			{payload.actionType === "deleteMemoryBatch" && (
				<p className="text-[11px] text-muted-foreground">
					<Trans>Memory entries: {count}</Trans>
				</p>
			)}
			{payload.actionType === "acceptGlobalMemory" && payload.supersedeId && (
				<p className="text-[11px] text-muted-foreground">
					<Trans>Replaces memory</Trans>
				</p>
			)}
			{approval.status === "pending" &&
				payload.actionType === "stopTeam" &&
				!payload.member && (
					<p className="text-[10px] text-muted-foreground">
						<Trans>The Leader terminal continues running.</Trans>
					</p>
				)}
			{(approval.status === "pending" || approval.status === "expired") && (
				<p className="text-[10px] text-muted-foreground">
					{expired
						? t({ message: `Expired ${time}` })
						: t({ message: `Expires ${time}` })}
				</p>
			)}
			<details className="text-[11px] text-muted-foreground">
				<summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<Trans>Details</Trans>
				</summary>
				<div className="mt-2 space-y-2">
					<p className="whitespace-pre-wrap break-words">{approval.summary}</p>
					<p className="break-all font-mono">{approval.id}</p>
					<p className="break-all font-mono">{approval.targetId}</p>
					<pre className="whitespace-pre-wrap break-words font-mono">
						{JSON.stringify(payload, null, 2)}
					</pre>
				</div>
			</details>
			{approval.error && (
				<p role="alert" className="break-words text-[11px] text-destructive">
					{approval.error}
				</p>
			)}
			{blocked && (
				<p role="alert" className="text-[11px] text-destructive">
					<Trans>The result is uncertain. Refresh before deciding again.</Trans>
				</p>
			)}
			{approval.status === "pending" && (
				<div className="flex gap-2 pt-0.5">
					<Button
						size="sm"
						variant="secondary"
						className="h-7 min-w-0 flex-1 px-3 text-xs"
						disabled={!enabled}
						onClick={() => onResolve("reject")}
					>
						<Trans>Reject</Trans>
					</Button>
					<Button
						size="sm"
						className="h-7 min-w-0 flex-1 px-3 text-xs"
						disabled={!enabled}
						onClick={() => onResolve("approve")}
					>
						{confirm}
					</Button>
				</div>
			)}
		</article>
	);
}
