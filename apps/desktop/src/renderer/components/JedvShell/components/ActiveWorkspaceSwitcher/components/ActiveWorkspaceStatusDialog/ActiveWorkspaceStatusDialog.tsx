import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans } from "@lingui/react/macro";
export function ActiveWorkspaceStatusDialog({
	failed,
	loading,
	hostLabel,
	onRetry,
	onClose,
}: {
	failed: boolean;
	loading: boolean;
	hostLabel: string;
	onRetry(): void;
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
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Active workspaces</Trans>
					</DialogTitle>
					<DialogDescription>{hostLabel}</DialogDescription>
				</DialogHeader>
				{failed ? (
					<p role="alert" className="text-sm text-destructive">
						<Trans>
							Could not load workspace status. Check the target host and try
							again.
						</Trans>
					</p>
				) : (
					<output className="text-sm text-muted-foreground">
						<Trans>Loading workspace status…</Trans>
					</output>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					{failed && (
						<Button disabled={loading} onClick={onRetry}>
							<Trans>Retry</Trans>
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
