import type { ButlerApprovalShape } from "@jedv/shared/butler";
import type { WatchdogAlertShape } from "@jedv/shared/memory";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEye } from "react-icons/lu";
import type { Team } from "../../../../hooks/useTeamwork";
import type { Workspace } from "../../../../types";
import { JedvIconButton } from "../../../JedvIconButton";
import { ButlerApprovalCard } from "../ButlerApprovalCard";
export function ButlerInbox({
	alerts,
	approvals,
	workspaces,
	teams,
	pending,
	blocked,
	onResolve,
	onRead,
}: {
	alerts: WatchdogAlertShape[];
	approvals: ButlerApprovalShape[];
	workspaces: Workspace[];
	teams: Team[];
	pending: boolean;
	blocked: Set<string>;
	onResolve(
		approval: ButlerApprovalShape,
		decision: "approve" | "reject",
	): void;
	onRead(id: string): void;
}) {
	const { t } = useLingui();
	return (
		<div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
			<h3 className="text-[10px] font-medium text-muted-foreground">
				<Trans>Approvals</Trans>
			</h3>
			{approvals.length === 0 && (
				<p className="text-[11px] text-muted-foreground">
					<Trans>No pending approvals.</Trans>
				</p>
			)}
			{approvals.map((approval) => (
				<ButlerApprovalCard
					key={approval.id}
					approval={approval}
					workspaces={workspaces}
					teams={teams}
					pending={pending}
					blocked={blocked.has(approval.id)}
					onResolve={(decision) => onResolve(approval, decision)}
				/>
			))}
			<h3 className="pt-2 text-[10px] font-medium text-muted-foreground">
				<Trans>Alerts</Trans>
			</h3>
			{alerts.length === 0 && (
				<p className="text-[11px] text-muted-foreground">
					<Trans>No alerts.</Trans>
				</p>
			)}
			{alerts.map((alert) => (
				<article
					key={alert.id}
					className="space-y-1.5 rounded-md border border-border p-2 text-[11px]"
				>
					<div className="flex items-start gap-1">
						<p className="flex-1 font-medium">
							{alert.kind === "suspected_stalled"
								? t({ message: "Agent may be stalled" })
								: alert.kind === "mail_unacked"
									? t({ message: "Mail awaits acknowledgement" })
									: t({ message: "Automation did not finish" })}
						</p>
						{alert.readAt == null && (
							<JedvIconButton
								label={t({ message: "Mark as read" })}
								className="size-5"
								disabled={pending}
								onClick={() => onRead(alert.id)}
							>
								<LuEye className="size-3" />
							</JedvIconButton>
						)}
					</div>
					<p className="text-[10px] text-muted-foreground">
						<Trans>Read-only alert</Trans>
					</p>
					<details>
						<summary className="cursor-pointer rounded text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring">
							<Trans>Details</Trans>
						</summary>
						<p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
							{alert.subject}
							{"\n"}
							{alert.body}
						</p>
					</details>
				</article>
			))}
		</div>
	);
}
