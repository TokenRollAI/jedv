import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
export function IgnoreAttentionDialog({
	subject,
	onIgnore,
	onClose,
}: {
	subject: string;
	onIgnore(reason?: string): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [reason, setReason] = useState(""),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	const busy = useRef(false);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent
				className="sm:max-w-lg"
				showCloseButton={!pending}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Ignore suggestion</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Ignoring this suggestion does not acknowledge mail or resolve its
							cause.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<p className="break-words text-xs">{subject}</p>
				<Textarea
					aria-label={t({ message: "Reason (optional)" })}
					placeholder={t({ message: "Reason (optional)" })}
					value={reason}
					maxLength={2000}
					disabled={pending}
					className="resize-none text-xs"
					onChange={(event) => setReason(event.target.value)}
				/>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>Operation failed</Trans>
					</p>
				)}
				<DialogFooter>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={pending}
						onClick={onClose}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={pending}
						onClick={async () => {
							if (busy.current) return;
							busy.current = true;
							setPending(true);
							setError(false);
							try {
								await onIgnore(reason.trim() || undefined);
								onClose();
							} catch {
								setError(true);
							} finally {
								busy.current = false;
								setPending(false);
							}
						}}
					>
						<Trans>Ignore</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
