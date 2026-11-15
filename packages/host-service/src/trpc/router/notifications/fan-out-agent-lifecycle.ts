import type { AgentIdentity } from "@jedv/shared/agent-identity";
import type { AgentLifecycleEventType } from "../../../events";
import type { HostServiceContext } from "../../../types";
import { touchLocalWorkspaceActivity } from "../../../workspaces/local-workspace-store";
import { continueWorkspaceNaming } from "../workspace-creation/utils/workspace-naming-job";

export function fanOutAgentLifecycle(
	ctx: HostServiceContext,
	event: {
		workspaceId: string;
		eventType: AgentLifecycleEventType;
		terminalId: string;
		agent?: AgentIdentity;
		preview?: string;
		occurredAt: number;
	},
): void {
	const { workspaceId, eventType, preview, occurredAt } = event;
	ctx.eventBus.broadcastAgentLifecycle(event);

	// Every lifecycle event is activity for the sidebar's "Last active"
	// ranking. Best-effort: a failed write must not fail the caller, which
	// also drives the chime and the status dots.
	try {
		touchLocalWorkspaceActivity(ctx, workspaceId, occurredAt);
	} catch (err) {
		console.warn(
			`[agent-lifecycle] failed to record activity for workspace ${workspaceId}:`,
			err,
		);
	}

	try {
		continueWorkspaceNaming(ctx, workspaceId, {
			eventType,
			agentReply: preview,
		});
	} catch (err) {
		console.warn(
			`[agent-lifecycle] failed to schedule naming for workspace ${workspaceId}:`,
			err,
		);
	}
}
