import { acpHarnessForPreset as sharedAcpHarnessForPreset } from "@jedv/chat/core";

type AcpTranslator =
	| { adapter: string; executableEnv: string }
	| { adapter?: undefined; executableEnv?: undefined };

export type AcpHarness = {
	registryId: string;
	binary: string;
	args: string[];
	minVersion: string;
	upgrade?: string;
	/** The agent's own id for its unrestricted mode; chats start in it. */
	fullAccessModeId?: string;
	clientApprovalModes?: boolean;
	/** Forks a session up to a given message (JetBrains AIR fork point), so a rewind keeps the agent's own history. */
	forkAtMessage?: boolean;
	note: string;
} & AcpTranslator;

export const UNGATED_VERSION = "0.0.0";

export const ACP_HARNESSES: Record<string, AcpHarness> = {
	"agy-acp": {
		registryId: "agy-acp",
		binary: "agy",
		args: ["acp", "--stdio"],
		minVersion: "1.5.8",
		upgrade: "Update Antigravity CLI to 1.5.8 or later.",
		note: "1.5.8 ships a native ACP stdio server. Session handoff is gated by the control broker.",
	},
	"kimi-acp": {
		registryId: "kimi-acp",
		binary: "kimi",
		args: ["acp"],
		minVersion: "2.6.2",
		upgrade: "kimi upgrade",
		note: "2.6.2 ships a native ACP stdio server. Session handoff is gated by the control broker.",
	},
	"claude-acp": {
		registryId: "claude-acp",
		binary: "claude",
		args: [],
		minVersion: "2.1.226",
		adapter: "@agentclientprotocol/claude-agent-acp",
		executableEnv: "CLAUDE_CODE_EXECUTABLE",
		upgrade: "npm i -g @anthropic-ai/claude-code@latest",
		fullAccessModeId: "bypassPermissions",
		forkAtMessage: true,
		note: "2.1.226 verified against adapter 0.85.0: session/new returns the same modes and configOptions as 2.1.286.",
	},
	"codex-acp": {
		registryId: "codex-acp",
		binary: "codex",
		args: [],
		minVersion: "0.160.0",
		adapter: "@agentclientprotocol/codex-acp",
		executableEnv: "CODEX_PATH",
		upgrade: "npm i -g @openai/codex@latest",
		fullAccessModeId: "agent-full-access",
		forkAtMessage: true,
		note: "Conservative: the adapter drives `codex app-server`, and the release that introduced it is not pinned. The native codex adapter's MIN_CODEX_VERSION is 0.143.0, so this floor is probably lowerable once app-server is verified against an older build.",
	},
};

/**
 * The floor for a CLI, by the harness that documents it. The non-ACP harnesses
 * drive the same binaries, so they gate on the same versions.
 */
export function cliFloor(harness: string): {
	minVersion: string;
	upgrade?: string;
} {
	const entry = ACP_HARNESSES[harness];
	return {
		minVersion: entry?.minVersion ?? UNGATED_VERSION,
		upgrade: entry?.upgrade,
	};
}

export function acpHarnessForPreset(presetId: string): string | undefined {
	const harness = sharedAcpHarnessForPreset(presetId);
	return harness && ACP_HARNESSES[harness] ? harness : undefined;
}
