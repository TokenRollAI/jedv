import {
	agentStatusFromEvent,
	highestAgentStatus,
} from "@jedv/shared/agent-status";
import { useLingui } from "@lingui/react/macro";
import {
	useWorkspaceReadReceipts,
	workspaceReadThrough,
} from "../../../JedvWorkspacesBoard/stores/read-receipts";
export interface TerminalActivityEvent {
	terminalId: string;
	lastEventType: string;
	lastEventAt: number;
	endedAt?: number | null;
}
export function TerminalTabActivity({
	hostUrl,
	workspaceId,
	terminalIds,
	events,
	paneCount,
}: {
	hostUrl: string;
	workspaceId: string;
	terminalIds: readonly string[];
	events: readonly TerminalActivityEvent[];
	paneCount: number;
}) {
	const { t } = useLingui();
	const receipts = useWorkspaceReadReceipts((state) => state.receipts);
	const rows = events.filter(
		(event) => terminalIds.includes(event.terminalId) && event.endedAt == null,
	);
	const status = highestAgentStatus(
		rows.map((event) => agentStatusFromEvent(event.lastEventType)),
	);
	const unread =
		workspaceReadThrough(receipts, hostUrl, workspaceId) <
		Math.max(0, ...rows.map((event) => event.lastEventAt));
	const label =
		status === "permission"
			? t({ message: "Waiting for approval" })
			: status === "failed"
				? t({ message: "Agent failed" })
				: status === "working"
					? t({ message: "Working" })
					: status === "review" && unread
						? t({ message: "Finished · unread" })
						: null;
	return (
		<span className="ml-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
			{label && (
				<span
					role="img"
					aria-label={label}
					title={label}
					className={`size-1.5 rounded-full ${status === "permission" ? "bg-warning" : status === "failed" ? "bg-destructive" : status === "working" ? "animate-pulse bg-chart-1" : "bg-emerald-500"}`}
				/>
			)}
			{paneCount > 1 && <span>{paneCount}</span>}
		</span>
	);
}
