import type { AgentBinding, ExistingAgentSelection } from "../types";
import { nativeProvider } from "../types";
export function selectionForBinding(
	binding: AgentBinding,
): ExistingAgentSelection | null {
	const provider = nativeProvider(binding.agentId);
	if (binding.chatSessionId)
		return provider
			? {
					source: "chat-session",
					provider,
					terminalId: null,
					chatSessionId: binding.chatSessionId,
					nativeSessionId: binding.agentSessionId,
					agentConfigId: binding.definitionId,
					bindingTerminalId: binding.terminalId,
				}
			: null;
	return {
		source: "cli",
		terminalId: binding.terminalId,
		provider: provider ?? undefined,
		nativeSessionId: binding.agentSessionId,
		agentConfigId: binding.definitionId,
	};
}
