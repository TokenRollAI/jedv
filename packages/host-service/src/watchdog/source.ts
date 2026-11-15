import type {
	AttentionSourceInput,
	AttentionSourceTarget,
} from "@jedv/shared/butler-attention";

export function attentionSource(
	input: AttentionSourceInput,
): AttentionSourceTarget {
	return {
		kind: input.kind,
		teamId: input.teamId ?? null,
		memberId: input.memberId ?? null,
		projectId: input.projectId ?? null,
		workspaceId: input.workspaceId ?? null,
		terminalId: input.terminalId ?? null,
		terminalLive: false,
		fallback: input.workspaceId
			? "workspace"
			: input.teamId
				? "team"
				: input.kind === "automation_run"
					? "automations"
					: input.kind === "memory"
						? "memory"
						: null,
		mailDeliveryId: input.mailDeliveryId ?? null,
		automationId: input.automationId ?? null,
		automationRunId: input.automationRunId ?? null,
	};
}
