import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import { Button } from "@jedv/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@jedv/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { useRunAfterMenuClose } from "@jedv/ui/hooks/use-run-after-menu-close";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { Settings } from "lucide-react";
import { useState } from "react";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { resolveV2PresetIcon } from "renderer/lib/preset-icon";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { LocalClient } from "../../local-client";
import type { JedvParityViewContext } from "../../parity-types";
import type { HostAgentConfig } from "../../types";
import { PresetEditor } from "../JedvSettingsView/components/TerminalPresets/components/PresetEditor/PresetEditor";
import type { ExistingAgentSelection } from "../NativeAgentControls/components/AgentSessionPicker";
import { PresetBarItem } from "./components/PresetBarItem";
import { PresetVisibilityItem } from "./components/PresetVisibilityItem";
export function JedvAgentLaunchBar({
	configs,
	disabled,
	onSettings,
	presets = [],
	onRunPreset,
	editorContext,
}: {
	sessionPicker?: {
		client: LocalClient;
		hostUrl: string;
		workspaceId: string;
		onSelectSession(selection: ExistingAgentSelection): Promise<void>;
	};
	presets?: TerminalPreset[];
	onRunPreset?(preset: TerminalPreset): void;
	configs: HostAgentConfig[];
	disabled: boolean;
	onLaunch(config: HostAgentConfig): void;
	onSettings(): void;
	editorContext?: JedvParityViewContext;
}) {
	const { t } = useLingui();
	const isDark = useIsDarkTheme();
	const utils = electronTrpc.useUtils();
	const [pending, setPending] = useState<string | null>(null);
	const [editing, setEditing] = useState<TerminalPreset | null>(null);
	const { runAfterClose, onCloseAutoFocus } = useRunAfterMenuClose();
	const refresh = () => utils.settings.getTerminalPresets.invalidate();
	const changeVisibility = async (preset: TerminalPreset) => {
		if (pending) return;
		setPending(preset.id);
		try {
			await electronTrpcClient.settings.updateTerminalPreset.mutate({
				id: preset.id,
				patch: { pinnedToBar: preset.pinnedToBar === false },
			});
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setPending(null);
		}
	};
	return (
		<>
			<div className="flex h-9 min-w-0 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border/60 bg-muted/20 px-2 py-1 [scrollbar-width:none]">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t({ message: "Manage Terminal Scripts" })}
							className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
						>
							<Settings className="size-3.5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="w-64"
						onCloseAutoFocus={onCloseAutoFocus}
					>
						{presets.map((preset) => (
							<PresetVisibilityItem
								key={preset.id}
								preset={preset}
								icon={resolveV2PresetIcon(preset, configs, isDark)}
								index={presets
									.filter((item) => item.pinnedToBar !== false)
									.findIndex((item) => item.id === preset.id)}
								disabled={pending !== null}
								onToggle={() => void changeVisibility(preset)}
							/>
						))}

						<DropdownMenuSeparator />
						<DropdownMenuCheckboxItem
							checked
							onCheckedChange={() => {
								void electronTrpcClient.settings.setShowPresetsBar
									.mutate({ enabled: false })
									.then(() => utils.settings.getShowPresetsBar.invalidate())
									.catch((error) => toast.error(String(error)));
							}}
						>
							<Trans>Show Scripts Bar</Trans>
						</DropdownMenuCheckboxItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => runAfterClose(onSettings)}>
							<Settings className="size-4" />
							<Trans>Manage Terminal Scripts</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{onRunPreset &&
					presets
						.filter((preset) => preset.pinnedToBar !== false)
						.map((preset, index) => (
							<PresetBarItem
								key={preset.id}
								preset={preset}
								icon={resolveV2PresetIcon(preset, configs, isDark)}
								index={index}
								disabled={
									disabled || !preset.commands.some((command) => command.trim())
								}
								onRun={() => onRunPreset(preset)}
								onEdit={() =>
									editorContext && !editorContext.remote
										? setEditing(preset)
										: onSettings()
								}
							/>
						))}
			</div>
			{editing && editorContext && (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open) setEditing(null);
					}}
				>
					<DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
						<DialogTitle>
							<Trans>Edit terminal preset</Trans>
						</DialogTitle>
						<PresetEditor
							preset={editing}
							projects={editorContext.projects}
							agents={configs}
							agentsPending={false}
							readPresets={() =>
								electronTrpcClient.settings.getTerminalPresets.query()
							}
							loadAgents={() =>
								editorContext.client.settings.agentConfigs.list.query()
							}
							onSaved={async () => {
								await refresh();
								setEditing(null);
							}}
							onCancel={() => setEditing(null)}
						/>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
