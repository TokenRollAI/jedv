import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import type { ComponentProps, ReactNode } from "react";
import type { HostAgentConfig, TerminalSession } from "../../types";
import { JedvAgentLaunchBar } from "../JedvAgentLaunchBar";
import type { TerminalLayoutStore } from "../JedvTerminalWorkspace/layout";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";

export function JedvTerminalTabStrip({
	onTabBarMount,
	onLaunch,
	onSettings,
	editorContext,
	agentConfigs,
	tools,
	ports,
	showWindowControls = true,
	changes,
	enabled,
	showPresetsBar,
	presets,
	onRunPreset,
	sessionPicker,
}: {
	store: TerminalLayoutStore;
	sessions: TerminalSession[];
	onTabBarMount(node: HTMLDivElement | null): void;
	onAttach(id: string): void;
	onKill(id: string): void;
	onLaunch(config: HostAgentConfig): void;
	onSettings(): void;
	editorContext?: ComponentProps<typeof JedvAgentLaunchBar>["editorContext"];
	agentConfigs: HostAgentConfig[];
	tools: ReactNode;
	ports?: ReactNode;
	showWindowControls?: boolean;
	changes: ReactNode;
	enabled: boolean;
	connected: boolean;
	showPresetsBar: boolean;
	presets: TerminalPreset[];
	sessionPicker?: ComponentProps<typeof JedvAgentLaunchBar>["sessionPicker"];
	onRunPreset(preset: TerminalPreset): void;
}) {
	return (
		<>
			<WindowChrome
				primary
				height={48}
				className="bg-muted/45 shadow-[inset_0_-1px_0_var(--border)] dark:bg-muted/35"
			>
				<WindowChromeLeading />
				<div
					ref={onTabBarMount}
					className="no-drag flex min-w-0 flex-1 self-stretch"
				/>
				<div className="drag min-w-4" />
				<WindowChromeControls className="shrink-0 pr-2">
					<div className="flex items-center gap-1">
						{ports}
						{changes}
						{tools}
					</div>
				</WindowChromeControls>
				{showWindowControls && <WindowControlsInset />}
			</WindowChrome>
			{showPresetsBar && (
				<JedvAgentLaunchBar
					editorContext={editorContext}
					configs={agentConfigs}
					disabled={!enabled}
					onLaunch={onLaunch}
					onSettings={onSettings}
					presets={presets}
					onRunPreset={onRunPreset}
					sessionPicker={sessionPicker}
				/>
			)}
		</>
	);
}
