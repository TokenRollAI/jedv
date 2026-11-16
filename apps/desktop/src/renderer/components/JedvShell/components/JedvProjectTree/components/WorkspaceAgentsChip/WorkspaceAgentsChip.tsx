import {
	ACTIVE_AGENT_STATUSES,
	agentStatusFromEvent,
} from "@jedv/shared/agent-status";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@jedv/ui/hover-card";
import { useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { ActiveBinding } from "../../../ActiveWorkspaceSwitcher/active-workspaces";
import type { WorkspaceAgentSession } from "../ProjectTreeWorkspace/session-rows";
import { WorkspaceAgentSessionRow } from "../WorkspaceAgentSessionRow";

export function WorkspaceAgentsChip({
	bindings,
	sessions,
	onOpen,
}: {
	bindings: ActiveBinding[];
	sessions?: Map<string, WorkspaceAgentSession>;
	onOpen(terminalId: string): void;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const suppressHover = useRef(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const contentId = useId();
	const subagentCount = bindings.reduce(
		(total, binding) => total + (binding.subagents?.length ?? 0),
		0,
	);
	if (bindings.length === 0 || (bindings.length < 2 && subagentCount === 0))
		return null;
	const priority = (binding: ActiveBinding) => {
		const status = agentStatusFromEvent(binding.lastEventType);
		return status ? ACTIVE_AGENT_STATUSES.indexOf(status) : -1;
	};
	const primary = bindings.reduce((best, binding) =>
		priority(binding) > priority(best) ||
		(priority(binding) === priority(best) && binding.startedAt > best.startedAt)
			? binding
			: best,
	);
	const label = t({ message: "Agents" });
	return (
		<HoverCard
			open={open}
			openDelay={150}
			closeDelay={120}
			onOpenChange={(next) => {
				if (!next || !suppressHover.current) setOpen(next);
			}}
		>
			<HoverCardTrigger asChild>
				<button
					ref={trigger}
					type="button"
					aria-label={`${label}: ${bindings.length}${subagentCount ? ` +${subagentCount}` : ""}`}
					aria-expanded={open}
					aria-controls={open ? contentId : undefined}
					className="flex h-[18px] shrink-0 items-center gap-1 rounded bg-muted/60 px-1.5 text-[9px] font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					onPointerLeave={() => {
						suppressHover.current = false;
					}}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						suppressHover.current = open;
						setOpen(!open);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							suppressHover.current = true;
							setOpen(false);
						}
					}}
				>
					<AgentIcon presetId={primary.agentId} className="size-2.5" />
					<span>{bindings.length}</span>
					{subagentCount > 0 && (
						<span className="font-normal">+{subagentCount}</span>
					)}
				</button>
			</HoverCardTrigger>
			<HoverCardContent
				id={contentId}
				side="right"
				align="start"
				sideOffset={8}
				className="w-64 p-1"
				onEscapeKeyDown={() => {
					suppressHover.current = true;
					setOpen(false);
					trigger.current?.focus();
				}}
			>
				<div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">
					<span>{label}</span>
					<span className="tabular-nums">{bindings.length}</span>
				</div>
				<div className="max-h-60 overflow-y-auto">
					{bindings.map((binding) => (
						<div key={binding.terminalId}>
							<WorkspaceAgentSessionRow
								session={
									sessions?.get(binding.terminalId) ?? {
										terminalId: binding.terminalId,
										name: `${binding.agentId} · ${binding.terminalId.slice(0, 8)}`,
										provider: binding.agentId,
										location: "unknown",
									}
								}
								onOpen={() => {
									setOpen(false);
									onOpen(binding.terminalId);
								}}
							/>
							{binding.subagents?.map((subagent) => (
								<div
									key={subagent.id}
									className="ml-5 truncate px-1 py-0.5 text-[10px] text-muted-foreground"
									title={subagent.id}
								>
									{subagent.agentType || subagent.id}
								</div>
							))}
						</div>
					))}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
