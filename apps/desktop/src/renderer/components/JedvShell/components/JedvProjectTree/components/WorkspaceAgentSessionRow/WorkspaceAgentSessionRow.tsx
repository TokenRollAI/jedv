import { useLingui } from "@lingui/react/macro";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { WorkspaceAgentSession } from "../ProjectTreeWorkspace/session-rows";

export function WorkspaceAgentSessionRow({
	session,
	onOpen,
}: {
	session: WorkspaceAgentSession;
	onOpen(): void;
}) {
	const { t } = useLingui();
	const name = session.name;
	const location =
		session.location === "tab"
			? t({ message: "In tab" })
			: session.location === "right"
				? t({ message: "In right pane" })
				: session.location === "background"
					? t({ message: "Background" })
					: t({ message: "Location unavailable" });
	return (
		<button
			type="button"
			title={`${name} · ${location}`}
			aria-label={t({ message: `Open ${name} session` })}
			className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left text-muted-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
			onClick={onOpen}
		>
			<AgentIcon presetId={session.provider} className="size-3 shrink-0" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[11px] text-foreground">
					{name}
				</span>
				<span className="flex flex-wrap gap-x-1 text-[10px]">
					<span className="min-w-0 truncate">{session.provider}</span>
					<span>{location}</span>
				</span>
			</span>
		</button>
	);
}
