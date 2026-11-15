import type { AgentIslandApprovalEvent } from "shared/types/agent-island";
import type { LocalClient } from "../../local-client";

interface ApprovalConnection {
	hostId: string;
	client: LocalClient;
}
export async function executeIslandApproval(
	event: AgentIslandApprovalEvent,
	deps: {
		connection(): ApprovalConnection | null;
		complete(input: { actionId: string; ok: boolean }): Promise<unknown>;
		refresh(): Promise<unknown>;
	},
): Promise<boolean> {
	let ok = false;
	try {
		const connection = deps.connection();
		if (!connection || connection.hostId !== event.hostId) return false;
		const identity = {
			workspaceId: event.workspaceId,
			provider: event.provider,
			nativeSessionId: event.nativeSessionId,
			agentConfigId: event.agentConfigId,
		};
		const state =
			await connection.client.terminalAgents.queryNativeSession.query(identity);
		const current = deps.connection();
		if (
			!current ||
			current.client !== connection.client ||
			current.hostId !== event.hostId ||
			("source" in state && state.source !== "native-session") ||
			state.workspaceId !== event.workspaceId ||
			state.provider !== event.provider ||
			state.nativeSessionId !== event.nativeSessionId ||
			state.profileHash !== event.profileHash ||
			state.leaseEpoch !== event.expectedLeaseEpoch ||
			state.activeWriter !== "control" ||
			!state.pendingApprovals.some((item) => item.requestId === event.requestId)
		)
			return false;
		await connection.client.terminalAgents.controlNativeSession.mutate({
			...identity,
			expectedLeaseEpoch: event.expectedLeaseEpoch,
			action: {
				type: "approve",
				requestId: event.requestId,
				decision: event.decision,
			},
		});
		ok = true;
	} catch {
	} finally {
		try {
			await deps.complete({ actionId: event.actionId, ok });
		} catch {}
		try {
			await deps.refresh();
		} catch {}
	}
	return ok;
}
