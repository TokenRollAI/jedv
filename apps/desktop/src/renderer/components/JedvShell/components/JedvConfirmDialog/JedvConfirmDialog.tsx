import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@jedv/ui/alert-dialog";
import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
export interface Confirmation {
	title: string;
	description: string;
	detail: string;
	execute(): Promise<void>;
}
export function JedvConfirmDialog({
	confirmation,
	onClose,
}: {
	confirmation: Confirmation;
	onClose(): void;
}) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
					<AlertDialogDescription>
						{confirmation.description}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
					{confirmation.detail}
				</pre>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<Button
						variant="destructive"
						disabled={pending}
						onClick={async () => {
							setPending(true);
							try {
								await confirmation.execute();
								onClose();
							} catch (cause) {
								setError(
									cause instanceof Error ? cause.message : String(cause),
								);
							} finally {
								setPending(false);
							}
						}}
					>
						<Trans>Confirm</Trans>
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
