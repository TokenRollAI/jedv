import type { AttentionSourceTarget } from "@jedv/shared/butler-attention";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans } from "@lingui/react/macro";
import type { JedvParityViewContext } from "../../../../parity-types";
import { AutomationRuns } from "../../../JedvAutomationsView/components/AutomationRuns/AutomationRuns";
export function AttentionAutomationSource({
	source,
	context,
	onClose,
}: {
	source: AttentionSourceTarget;
	context: JedvParityViewContext;
	onClose(): void;
}) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				aria-describedby={undefined}
				className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-4xl"
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Run History</Trans>
					</DialogTitle>
				</DialogHeader>
				{source.automationId ? (
					<AutomationRuns
						client={context.client}
						hostUrl={context.hostUrl}
						automationId={source.automationId}
						initialRunId={source.automationRunId ?? undefined}
						onOpenWorkspace={context.onOpenWorkspace}
					/>
				) : (
					<p role="alert" className="text-xs text-muted-foreground">
						<Trans>Unavailable</Trans>
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
