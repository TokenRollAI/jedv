import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCopy, LuEye, LuEyeOff } from "react-icons/lu";
import { JedvIconButton } from "../../../../../JedvIconButton";
export function OneTimeSecret({
	title,
	value,
	onClose,
}: {
	title: string;
	value: string;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [visible, setVisible] = useState(false),
		[error, setError] = useState(false);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						<Trans>Shown once. Copy before closing.</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="flex min-w-0 items-center gap-1">
					<Input
						aria-label={title}
						type={visible ? "text" : "password"}
						readOnly
						value={value}
						autoComplete="off"
						className="min-w-0 flex-1 font-mono text-xs"
					/>
					<JedvIconButton
						label={visible ? t({ message: "Hide" }) : t({ message: "Show" })}
						onClick={() => setVisible(!visible)}
					>
						{visible ? (
							<LuEyeOff className="size-4" />
						) : (
							<LuEye className="size-4" />
						)}
					</JedvIconButton>
					<JedvIconButton
						label={t({ message: "Copy" })}
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(value);
								toast.success(t({ message: "Copied to clipboard" }));
							} catch {
								setError(true);
							}
						}}
					>
						<LuCopy className="size-4" />
					</JedvIconButton>
				</div>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>Operation failed</Trans>
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
