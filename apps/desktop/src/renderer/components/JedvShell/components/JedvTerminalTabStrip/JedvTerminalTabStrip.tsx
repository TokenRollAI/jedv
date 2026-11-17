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
	agentConfigs = [],
	files,
	tools,
	ports,
	showWindowControls = true,
	changes,
	enabled,
	showPresetsBar = true,
	presets = [],
	sessionPicker,
	onRunPreset,
}: {
	store: TerminalLayoutStore;
	sessions: TerminalSession[];
	onTabBarMount(node: HTMLDivElement | null): void;
	onAttach(id: string): void;
	onKill(id: string): void;
	onLaunch?(config: HostAgentConfig): void;
	onSettings?(): void;
	editorContext?: ComponentProps<typeof JedvAgentLaunchBar>["editorContext"];
	agentConfigs?: HostAgentConfig[];
	files?: ReactNode;
	tools: ReactNode;
	ports?: ReactNode;
	showWindowControls?: boolean;
	changes: ReactNode;
	enabled: boolean;
	connected: boolean;
	showPresetsBar?: boolean;
	presets?: TerminalPreset[];
	sessionPicker?: ComponentProps<typeof JedvAgentLaunchBar>["sessionPicker"];
	onRunPreset?(preset: TerminalPreset): void;
}) {
	const showQuickLaunchBar =
		showPresetsBar &&
		Boolean(sessionPicker) &&
		Boolean(onLaunch) &&
		Boolean(onSettings) &&
		(presets.length > 0 || agentConfigs.length > 0);
	return (
		<>
			<WindowChrome
				primary
				height={40}
				className="bg-sidebar/60 shadow-[inset_0_-1px_0_var(--border)]"
			>
				<WindowChromeLeading />
				<div
					ref={onTabBarMount}
					className="no-drag flex min-w-0 flex-1 self-stretch"
				/>
				<div className="drag min-w-4" />
				<WindowChromeControls className="shrink-0 pr-2.5">
					<div className="flex items-center gap-1">
						{ports}
						{files}
						{changes}
						{tools}
					</div>
				</WindowChromeControls>
				{showWindowControls && <WindowControlsInset />}
			</WindowChrome>
			{showQuickLaunchBar && onLaunch && onSettings && (
				<JedvAgentLaunchBar
					sessionPicker={sessionPicker}
					presets={presets}
					onRunPreset={onRunPreset}
					configs={agentConfigs}
					disabled={!enabled}
					onLaunch={onLaunch}
					onSettings={onSettings}
					editorContext={editorContext}
				/>
			)}
		</>
	);
}
