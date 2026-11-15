import type { ComponentProps } from "react";
import type { HostAgentConfig, TerminalSession } from "../../types";
import type { JedvAgentLaunchBar } from "../JedvAgentLaunchBar";
import type { TerminalLayoutStore } from "../JedvTerminalWorkspace/layout";
export type SessionPickerContext = NonNullable<
	ComponentProps<typeof JedvAgentLaunchBar>["sessionPicker"]
>;
export type SessionBinding = Awaited<
	ReturnType<
		SessionPickerContext["client"]["terminalAgents"]["listByWorkspace"]["query"]
	>
>[number];
export type ResumeCandidate = Awaited<
	ReturnType<
		SessionPickerContext["client"]["terminalAgents"]["resumeCandidates"]["query"]
	>
>[number];
export interface TerminalSessionsMenuProps {
	store: TerminalLayoutStore;
	sessions: TerminalSession[];
	activeId: string | null;
	targetPaneId?: string;
	enabled: boolean;
	connected: boolean;
	sessionPicker?: SessionPickerContext;
	configs: HostAgentConfig[];
	onAttach(id: string): void;
	onNew(): void;
	onKill(id: string, isCurrent?: () => boolean): void;
	onLaunch(config: HostAgentConfig): void;
	onSettings(): void;
}
