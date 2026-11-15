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
import { useState } from "react";
import type { UploadConfirmation } from "../../hooks/useFilesTabDrop";
export function FileUploadConfirm({
	options,
	onClose,
}: {
	options: UploadConfirmation;
	onClose(): void;
}) {
	const [busy, setBusy] = useState(false);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent
				onInteractOutside={(event) => {
					if (busy) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>{options.title}</DialogTitle>
					<DialogDescription className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
						{options.description}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button autoFocus variant="outline" disabled={busy} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant="destructive"
						disabled={busy}
						onClick={() => {
							setBusy(true);
							void options.actions[0].onClick?.().finally(() => {
								setBusy(false);
								onClose();
							});
						}}
					>
						{busy ? <Trans>Loading...</Trans> : options.actions[0].label}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
