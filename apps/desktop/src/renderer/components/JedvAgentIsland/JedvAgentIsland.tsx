import { errorMessage } from "@jedv/i18n/errors";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuLoaderCircle, LuX } from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	AGENT_ISLAND_EVENTS,
	type AgentIslandApprovalResultEvent,
	type AgentIslandEntry,
	type AgentIslandState,
} from "shared/types/agent-island";
import { IslandSessionRow } from "./components/IslandSessionRow";
import "./agent-island.css";

function failureIdentity(entry: AgentIslandEntry, requestId: string) {
	return JSON.stringify([
		entry.entryId,
		entry.nativeSessionId,
		entry.profileHash,
		entry.leaseEpoch,
		requestId,
	]);
}

function priority(entry: AgentIslandEntry): number {
	return entry.pendingApprovals.length ||
		entry.turnState === "awaiting-approval"
		? 0
		: entry.turnState === "running"
			? 1
			: entry.completedUnread
				? 2
				: 3;
}

export function JedvAgentIsland() {
	const { t } = useLingui();
	const [state, setState] = useState<AgentIslandState | null>(null);
	const expanded = state?.visible === true;
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<Record<string, string>>({});
	const [failed, setFailed] = useState<string[]>([]);
	const actions = useRef(
		new Map<string, { entryId: string; identity: string }>(),
	);
	const revision = useRef(-1);
	const bindingIdentity = useRef("");
	const earlyResults = useRef(new Map<string, boolean>());
	useEffect(() => {
		const update = (next: AgentIslandState) => {
			if (next.revision < revision.current) return;
			revision.current = next.revision;
			const identity = JSON.stringify(next.binding);
			if (bindingIdentity.current !== identity) {
				bindingIdentity.current = identity;
				setPending({});
				setFailed([]);
				actions.current.clear();
				earlyResults.current.clear();
			}
			setState(next);
		};
		const result = (next: AgentIslandApprovalResultEvent) => {
			const action = actions.current.get(next.actionId);
			if (!action) {
				if (earlyResults.current.size >= 32) earlyResults.current.clear();
				earlyResults.current.set(next.actionId, next.ok);
				return;
			}
			actions.current.delete(next.actionId);
			setPending((previous) => {
				const copy = { ...previous };
				delete copy[action.entryId];
				return copy;
			});
			if (!next.ok)
				setFailed((previous) => [...previous, action.identity].slice(-32));
		};
		window.ipcRenderer.on(AGENT_ISLAND_EVENTS.state, update);
		window.ipcRenderer.on(AGENT_ISLAND_EVENTS.approvalResult, result);
		void electronTrpcClient.agentIsland.getState
			.query()
			.then(update)
			.catch(() => setError(t({ message: "Agent status unavailable" })));
		return () => {
			window.ipcRenderer.off(AGENT_ISLAND_EVENTS.state, update);
			window.ipcRenderer.off(AGENT_ISLAND_EVENTS.approvalResult, result);
		};
	}, [t]);
	const entries = [...(state?.entries ?? [])].sort(
		(a, b) => priority(a) - priority(b),
	);
	const focus = (entry: AgentIslandEntry) => {
		if (!state?.binding) return;
		void electronTrpcClient.agentIsland.focusWorkspaceTerminal
			.mutate({ entryId: entry.entryId, hostId: state.binding.hostId })
			.catch(() =>
				setError(
					t({ message: "Open the main window to select this workspace" }),
				),
			);
	};
	const approve = async (
		entry: AgentIslandEntry,
		requestId: string,
		decision: "accept" | "decline",
	) => {
		if (
			!state?.binding ||
			!entry.nativeSessionId ||
			!entry.profileHash ||
			pending[entry.entryId]
		)
			return;
		setPending((previous) => ({ ...previous, [entry.entryId]: "sending" }));
		const expectedBinding = bindingIdentity.current;
		try {
			const response =
				await electronTrpcClient.agentIsland.requestApproval.mutate({
					entryId: entry.entryId,
					hostId: state.binding.hostId,
					profileHash: entry.profileHash,
					nativeSessionId: entry.nativeSessionId,
					expectedLeaseEpoch: entry.leaseEpoch,
					requestId,
					decision,
				});
			if (bindingIdentity.current !== expectedBinding) return;
			actions.current.set(response.actionId, {
				entryId: entry.entryId,
				identity: failureIdentity(entry, requestId),
			});
			setPending((previous) => ({
				...previous,
				[entry.entryId]: response.actionId,
			}));
			const early = earlyResults.current.get(response.actionId);
			if (early !== undefined) {
				earlyResults.current.delete(response.actionId);
				actions.current.delete(response.actionId);
				setPending((previous) => {
					const copy = { ...previous };
					delete copy[entry.entryId];
					return copy;
				});
				if (!early)
					setFailed((previous) =>
						[...previous, failureIdentity(entry, requestId)].slice(-32),
					);
			}
		} catch {
			setPending((previous) => {
				const copy = { ...previous };
				delete copy[entry.entryId];
				return copy;
			});
			setFailed((previous) =>
				[...previous, failureIdentity(entry, requestId)].slice(-32),
			);
		}
	};
	const approvals = entries.reduce(
		(count, entry) =>
			count +
			Math.max(
				entry.pendingApprovals.length,
				entry.turnState === "awaiting-approval" ? 1 : 0,
			),
		0,
	);
	const running = entries.filter(
		(entry) => entry.turnState === "running",
	).length;
	const completed = entries.filter((entry) => entry.completedUnread).length;
	return (
		<main className="agent-island-canvas">
			<fieldset
				className="agent-island-interactive border-0 p-0 m-0 min-w-0"
				aria-label={t({ message: "Agent Island" })}
			>
				<div className="agent-island-pill">
					<span className="flex items-center gap-2">
						{entries[0] ? (
							<AgentIcon presetId={entries[0].provider} className="size-4" />
						) : (
							<span className="size-1.5 rounded-full bg-muted-foreground" />
						)}
						<span className="truncate text-xs">
							{approvals ? (
								<Trans>{approvals} approvals</Trans>
							) : running ? (
								<Trans>{running} working</Trans>
							) : completed ? (
								<Trans>{completed} finished</Trans>
							) : (
								<Trans>Agents</Trans>
							)}
						</span>
					</span>
					<div className="flex items-center gap-2">
						{running > 0 && (
							<LuLoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
						)}
						<button
							type="button"
							aria-label={t({ message: "Close" })}
							className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
							onClick={() =>
								void electronTrpcClient.agentIsland.dismiss
									.mutate()
									.catch((cause) => setError(errorMessage(cause)))
							}
						>
							<LuX className="size-3.5" />
						</button>
					</div>
				</div>
				{expanded && (
					<section
						aria-label={t({ message: "Agent sessions" })}
						className="agent-island-panel"
					>
						<ol>
							{entries.map((entry) => (
								<IslandSessionRow
									key={entry.entryId}
									entry={entry}
									busy={!!pending[entry.entryId]}
									error={entry.pendingApprovals.some((approval) =>
										failed.includes(failureIdentity(entry, approval.requestId)),
									)}
									onFocus={() => focus(entry)}
									onApprove={(requestId, decision) =>
										void approve(entry, requestId, decision)
									}
								/>
							))}
						</ol>
						{entries.length === 0 && (
							<p className="px-3 py-4 text-center text-xs text-muted-foreground">
								<Trans>No active agents</Trans>
							</p>
						)}
						{error && (
							<p role="alert" className="px-3 py-2 text-xs text-destructive">
								{error}
							</p>
						)}
					</section>
				)}
			</fieldset>
		</main>
	);
}
