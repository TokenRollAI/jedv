import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans } from "@lingui/react/macro";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { HostAgentConfig } from "../../../../types";
import type { SessionPickerContext } from "../../types";
export function SessionLaunchDialog({
	configs,
	disabled,
	onLaunch,
	onSettings,
	onClose,
}: {
	target?: SessionPickerContext;
	configs: HostAgentConfig[];
	disabled: boolean;
	onLaunch(config: HostAgentConfig): void;
	onSettings(): void;
	onClose(): void;
}) {
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Run agent</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Start a new agent, or choose an existing session from Sessions.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap gap-2">
					{configs.map((config) => (
						<Button
							key={config.id}
							variant="outline"
							disabled={disabled}
							onClick={() => onLaunch(config)}
						>
							<AgentIcon
								presetId={config.presetId}
								iconId={config.iconId}
								className="size-4"
							/>
							{config.label}
						</Button>
					))}
					<Button variant="ghost" onClick={onSettings} disabled={disabled}>
						<Trans>Settings</Trans>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
