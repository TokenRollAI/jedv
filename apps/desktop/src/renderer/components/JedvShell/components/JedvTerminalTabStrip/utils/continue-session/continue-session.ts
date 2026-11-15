import {
	ExistingSessionError,
	resumeExistingCli,
} from "../../../NativeAgentControls/components/AgentSessionPicker/utils/resume-existing";
import { selectionForBinding } from "../../../NativeAgentControls/components/AgentSessionPicker/utils/selection";
import type { SessionPickerContext } from "../../types";
import type { SessionContinuation } from "../session-list";
export async function continueTerminalSession(
	target: SessionPickerContext,
	continuation: SessionContinuation,
) {
	if (continuation.kind === "resume") {
		const selection = await resumeExistingCli(
			target.client,
			target.workspaceId,
			continuation.candidate,
		);
		if (!selection) throw new ExistingSessionError("unsupported");
		return selection;
	}
	const expected = continuation.binding;
	const [terminals, binding] = await Promise.all([
		target.client.terminal.list.query({ workspaceId: target.workspaceId }),
		target.client.terminalAgents.get.query({
			workspaceId: target.workspaceId,
			terminalId: expected.terminalId,
		}),
	]);
	if (
		!terminals.sessions.some(
			(row) =>
				row.terminalId === expected.terminalId &&
				row.workspaceId === target.workspaceId &&
				!row.exited,
		) ||
		!binding ||
		binding.endedAt != null ||
		binding.workspaceId !== target.workspaceId ||
		binding.agentId !== expected.agentId ||
		binding.agentSessionId !== expected.agentSessionId ||
		binding.chatSessionId !== expected.chatSessionId ||
		binding.definitionId !== expected.definitionId
	)
		throw new ExistingSessionError("identity-changed");
	const selection = selectionForBinding(binding);
	if (!selection) throw new ExistingSessionError("unsupported");
	return selection;
}
