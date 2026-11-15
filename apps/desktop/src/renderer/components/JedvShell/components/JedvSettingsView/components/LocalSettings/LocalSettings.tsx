import { EXTERNAL_APPS, NON_EDITOR_APPS } from "@jedv/local-db";
import { TERMINAL_PARKED_RUNTIME_CAP_LIMITS } from "@jedv/shared/settings-constraints";
import { Switch } from "@jedv/ui/switch";
import { useLingui } from "@lingui/react/macro";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useTerminalCloseConfirmStore } from "renderer/stores/terminal-close-confirm/store";
import type {
	JedvParityViewContext,
	JedvSettingsSection,
} from "../../../../parity-types";
import { JedvDaemonStatus } from "../../../JedvDaemonStatus";
import { AsyncSetting } from "../AsyncSetting";
import { FontSettingSection } from "../FontSettingSection";
import { GeneralSettings } from "../GeneralSettings/GeneralSettings";
import { LinkBehaviorSettings } from "../LinkBehaviorSettings";
import { SettingRow } from "../SettingRow";
import { TerminalPresets } from "../TerminalPresets/TerminalPresets";
export function LocalSettings({
	section,
	context,
}: {
	context: JedvParityViewContext;
	section: Extract<JedvSettingsSection, "general" | "terminal" | "files">;
}) {
	const { t } = useLingui();
	const settings = electronTrpcClient.settings;
	const utils = electronTrpc.useUtils();
	const writeSetting = async (action: Promise<unknown>) => {
		const result = await action;
		await utils.settings.invalidate();
		return result;
	};
	const suppressed = useTerminalCloseConfirmStore((state) => state.suppressed);
	const suppress = useTerminalCloseConfirmStore((state) => state.suppress);
	const reset = useTerminalCloseConfirmStore((state) => state.reset);
	return (
		<div className="space-y-6">
			{section === "general" && <GeneralSettings />}
			{section === "terminal" && (
				<JedvDaemonStatus client={context.client} hostUrl={context.hostUrl} />
			)}

			<div className="rounded-lg border border-border overflow-hidden divide-y">
				{section === "general" && (
					<>
						<AsyncSetting
							id="confirm-on-quit"
							label={t({ message: "Confirm before quitting" })}
							description={t({ message: "Ask before quitting the app." })}
							read={() => settings.getConfirmOnQuit.query()}
							write={(enabled) =>
								writeSetting(settings.setConfirmOnQuit.mutate({ enabled }))
							}
						/>
						<AsyncSetting
							id="show-resource-monitor"
							label={t({ message: "Resource monitor" })}
							description={t({
								message: "Show local resource usage in the workspace.",
							})}
							read={() => settings.getShowResourceMonitor.query()}
							write={(enabled) =>
								writeSetting(
									settings.setShowResourceMonitor.mutate({ enabled }),
								)
							}
						/>
						<AsyncSetting
							id="wait-for-setup-before-agent"
							label={t({
								message: "Wait for workspace setup before starting an agent",
							})}
							description={t({
								message:
									"Do not start a new agent until workspace setup has succeeded or is not required. If setup fails or its status cannot be confirmed, starting the agent is blocked.",
							})}
							read={() => settings.getWaitForSetupBeforeAgent.query()}
							write={(enabled) =>
								writeSetting(
									settings.setWaitForSetupBeforeAgent.mutate({ enabled }),
								)
							}
						/>
						<AsyncSetting
							id="show-presets-bar"
							label={t({ message: "Workspace launcher" })}
							description={t({
								message:
									"Show agent commands and pinned terminal presets above the workspace.",
							})}
							read={() => settings.getShowPresetsBar.query()}
							write={(enabled) =>
								writeSetting(settings.setShowPresetsBar.mutate({ enabled }))
							}
						/>
						<AsyncSetting
							id="show-usage-in-sidebar"
							label={t({ message: "Usage in sidebar" })}
							description={t({
								message: "Show the Usage entry in the main sidebar.",
							})}
							read={() => settings.getShowUsageInSidebar.query()}
							write={(enabled) =>
								writeSetting(settings.setShowUsageInSidebar.mutate({ enabled }))
							}
						/>
					</>
				)}
				{section === "terminal" && (
					<>
						<SettingRow
							label={t({
								message: "Confirm before closing a running terminal",
							})}
							description={t({
								message:
									"Ask before terminating a terminal with a running process. Closing a view keeps its session running.",
							})}
						>
							<Switch
								aria-label={t({
									message: "Confirm before closing a running terminal",
								})}
								checked={!suppressed}
								onCheckedChange={(enabled) => (enabled ? reset() : suppress())}
							/>
						</SettingRow>
						<AsyncSetting
							id="terminal-parked-runtime-cap"
							label={t({ message: "Cached terminal views" })}
							description={t({
								message:
									"Maximum hidden terminal renderers kept in memory. Evicting a view keeps its PTY session running.",
							})}
							read={() => settings.getTerminalParkedRuntimeCap.query()}
							write={(cap) =>
								writeSetting(
									settings.setTerminalParkedRuntimeCap.mutate({ cap }),
								)
							}
							min={TERMINAL_PARKED_RUNTIME_CAP_LIMITS.min}
							max={TERMINAL_PARKED_RUNTIME_CAP_LIMITS.max}
							step={1}
						/>
						<AsyncSetting
							id="terminal-copy-on-select"
							label={t({ message: "Copy on select" })}
							description={t({
								message: "Copy selected terminal text to the clipboard.",
							})}
							read={() => settings.getTerminalCopyOnSelect.query()}
							write={(enabled) =>
								writeSetting(
									settings.setTerminalCopyOnSelect.mutate({ enabled }),
								)
							}
						/>
						<LinkBehaviorSettings
							surfaces={["url", "file", "folder"]}
							rightPaneAvailable
						/>
					</>
				)}
				{section === "files" && (
					<>
						<LinkBehaviorSettings
							surfaces={["url", "file", "sidebarFile", "folder"]}
							rightPaneAvailable
						/>
						<AsyncSetting
							id="file-open-mode"
							label={t({ message: "Open files in" })}
							read={() => settings.getFileOpenMode.query()}
							write={(mode) =>
								writeSetting(settings.setFileOpenMode.mutate({ mode }))
							}
							options={[
								{ value: "split-pane", label: t({ message: "Split pane" }) },
								{ value: "new-tab", label: t({ message: "New tab" }) },
							]}
						/>
						<AsyncSetting
							id="file-auto-save"
							label={t({ message: "Auto save" })}
							read={() => settings.getFileAutoSave.query()}
							write={(mode) =>
								writeSetting(settings.setFileAutoSave.mutate({ mode }))
							}
							options={[
								{ value: "off", label: t({ message: "Off" }) },
								{ value: "afterDelay", label: t({ message: "After delay" }) },
								{
									value: "onFocusChange",
									label: t({ message: "On focus change" }),
								},
								{
									value: "onWindowChange",
									label: t({ message: "On window change" }),
								},
							]}
						/>
						<AsyncSetting
							id="default-editor"
							label={t({ message: "Default external editor" })}
							read={async () =>
								(await settings.getDefaultEditor.query()) ?? "auto"
							}
							write={(editor) =>
								writeSetting(
									settings.setDefaultEditor.mutate({
										editor:
											editor === "auto"
												? null
												: (editor as (typeof EXTERNAL_APPS)[number]),
									}),
								)
							}
							options={[
								{ value: "auto", label: t({ message: "Auto" }) },
								...EXTERNAL_APPS.filter(
									(editor) => !NON_EDITOR_APPS.includes(editor),
								).map((editor) => ({ value: editor, label: editor })),
							]}
						/>
					</>
				)}
			</div>
			{section === "terminal" && <TerminalPresets {...context} />}
			{section !== "general" && (
				<FontSettingSection
					showEditor={section === "files"}
					showTerminal={section === "terminal"}
				/>
			)}
		</div>
	);
}
