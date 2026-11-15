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
import type { ReactNode } from "react";
export function GitConfirmDialog({
	title,
	description,
	children,
	label,
	destructive,
	busy,
	disabled = false,
	error,
	onCancel,
	onConfirm,
}: {
	title: string;
	description: string;
	children: ReactNode;
	label: string;
	destructive?: boolean;
	busy: boolean;
	disabled?: boolean;
	error: string | null;
	onCancel(): void;
	onConfirm(): void;
}) {
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
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<div className="max-h-64 overflow-auto break-words text-xs">
					{children}
				</div>
				{error && (
					<p
						role="alert"
						className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs text-destructive"
					>
						{error}
					</p>
				)}
				<DialogFooter>
					<Button
						autoFocus
						variant="outline"
						disabled={busy}
						onClick={onCancel}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						disabled={busy || disabled}
						onClick={onConfirm}
					>
						{busy ? <Trans>Loading...</Trans> : label}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
