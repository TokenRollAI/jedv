import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

export interface FileOperationTarget {
	path: string;
	name: string;
	directory: boolean;
	mode: "delete" | "move" | "copy";
}
export function FileOperationDialog({
	target,
	busy,
	error,
	onCancel,
	onConfirm,
}: {
	target: FileOperationTarget;
	busy: boolean;
	error: string | null;
	onCancel(): void;
	onConfirm(destination: string): void;
}) {
	const { t } = useLingui();
	const [destination, setDestination] = useState(target.path);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<DialogContent
				onInteractOutside={(event) => {
					if (busy) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{target.mode === "delete" ? (
							<Trans>Delete</Trans>
						) : target.mode === "move" ? (
							<Trans>Move</Trans>
						) : (
							<Trans>Copy</Trans>
						)}
					</DialogTitle>
					<DialogDescription className="break-all">
						{target.path}
					</DialogDescription>
				</DialogHeader>
				{target.mode === "delete" ? (
					<p className="text-sm">
						{target.directory ? (
							<Trans>
								This deletes the folder and all its contents. Unsaved editor
								buffers are kept. This action cannot be undone.
							</Trans>
						) : (
							<Trans>
								This deletes the file from disk. Unsaved editor buffers are
								kept. This action cannot be undone.
							</Trans>
						)}
					</p>
				) : (
					<form
						id="file-operation"
						onSubmit={(event) => {
							event.preventDefault();
							if (!busy && destination.trim()) onConfirm(destination);
						}}
					>
						<Input
							autoFocus
							aria-label={t({ message: "Destination path" })}
							value={destination}
							onChange={(event) => setDestination(event.target.value)}
							disabled={busy}
						/>
					</form>
				)}
				{error && (
					<p
						role="alert"
						className="max-h-40 overflow-auto break-words text-xs text-destructive"
					>
						{error}
					</p>
				)}
				<DialogFooter>
					<Button
						autoFocus={target.mode === "delete"}
						variant="outline"
						disabled={busy}
						onClick={onCancel}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant={target.mode === "delete" ? "destructive" : "default"}
						disabled={busy || !destination.trim()}
						onClick={() => onConfirm(destination)}
					>
						{busy ? (
							<Trans>Loading...</Trans>
						) : target.mode === "delete" ? (
							<Trans>Delete</Trans>
						) : target.mode === "move" ? (
							<Trans>Move</Trans>
						) : (
							<Trans>Copy</Trans>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
