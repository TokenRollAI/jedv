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

export function UnsavedFileDialog({
	path,
	busy,
	onCancel,
	onSave,
	onDiscard,
}: {
	path: string | null;
	busy: boolean;
	onCancel: () => void;
	onSave: () => void;
	onDiscard: () => void;
}) {
	return (
		<Dialog
			open={path !== null}
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Save changes before closing?</Trans>
					</DialogTitle>
					<DialogDescription>{path}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={onCancel}>
						<Trans>Cancel</Trans>
					</Button>
					<Button variant="destructive" disabled={busy} onClick={onDiscard}>
						<Trans>Discard changes</Trans>
					</Button>
					<Button disabled={busy} onClick={onSave}>
						<Trans>Save</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
