import type { LocalClient } from "../../../../local-client";
import type { NativeProvider } from "../../../../types";
export type AgentBinding = Awaited<
	ReturnType<LocalClient["terminalAgents"]["listByWorkspace"]["query"]>
>[number];
export type ChatSession = Awaited<
	ReturnType<LocalClient["sessions"]["list"]["query"]>
>[number];
export type ExistingAgentSelection =
	| {
			source: "cli";
			terminalId: string;
			provider?: NativeProvider;
			nativeSessionId?: string;
			agentConfigId?: string;
	  }
	| {
			source: "chat-session";
			terminalId: null;
			provider: NativeProvider;
			chatSessionId: string;
			nativeSessionId?: string;
			agentConfigId?: string;
			bindingTerminalId?: string;
	  };
export function nativeProvider(value: string): NativeProvider | null {
	return value === "codex" ||
		value === "claude" ||
		value === "agy" ||
		value === "kimi"
		? value
		: null;
}
