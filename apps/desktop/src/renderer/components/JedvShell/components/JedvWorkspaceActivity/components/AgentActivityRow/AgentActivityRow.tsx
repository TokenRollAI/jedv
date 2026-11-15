import { Trans, useLingui } from "@lingui/react/macro";
import { Bot } from "lucide-react";
import type { AgentIslandEntry } from "shared/types/agent-island";
export function AgentActivityRow({
	entry,
	onOpen,
}: {
	entry: AgentIslandEntry;
	onOpen?: () => void;
}) {
	const { t } = useLingui();
	const label =
		entry.pendingApprovals.length || entry.turnState === "awaiting-approval"
			? t({ message: "Awaiting Response" })
			: entry.completedUnread
				? t({ message: "Finished · unread" })
				: entry.turnState === "running"
					? t({ message: "Running" })
					: entry.turnState === "idle"
						? t({ message: "Idle" })
						: t({ message: "Unknown" });
	return (
		<button
			type="button"
			disabled={!onOpen}
			onClick={onOpen}
			className="flex min-h-7 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-60"
		>
			<Bot className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">
				{entry.provider} · {entry.summary || entry.workspaceName}
			</span>
			<span className="shrink-0 text-[11px] text-muted-foreground">
				{onOpen ? label : <Trans>Unavailable</Trans>}
			</span>
		</button>
	);
}
