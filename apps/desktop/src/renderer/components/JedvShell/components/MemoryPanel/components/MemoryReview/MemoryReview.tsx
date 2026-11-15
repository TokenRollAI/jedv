import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { JedvSelect } from "../../../JedvSelect";
import type { MemoryItem } from "../../types";
export function MemoryReview({
	candidate,
	entries,
	onAccept,
	onClose,
}: {
	candidate: MemoryItem;
	entries: MemoryItem[];
	onAccept(supersedeId?: string): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const selectId = useId();
	const [replacement, setReplacement] = useState(""),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	const choices = entries.filter(
		(item) =>
			item.scopeKind === candidate.scopeKind &&
			item.scopeId === candidate.scopeId &&
			item.status === "active" &&
			!item.supersededById &&
			item.id !== candidate.id,
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<DialogTitle>
					<Trans>Accept candidate</Trans>
				</DialogTitle>
				<DialogDescription>{candidate.title}</DialogDescription>
				<p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
					{candidate.content}
				</p>
				<label htmlFor={selectId} className="space-y-2 text-xs">
					<span>
						<Trans>Replace an existing memory</Trans>
					</span>
					<JedvSelect
						id={selectId}
						label={t({ message: "Replace an existing memory" })}
						value={replacement}
						onValueChange={setReplacement}
						disabled={pending}
						options={[
							{ value: "", label: t({ message: "Keep existing entries" }) },
							...choices.map((item) => ({ value: item.id, label: item.title })),
						]}
						className="w-full"
					/>
				</label>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>Memory action failed</Trans>
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" disabled={pending} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={pending}
						onClick={async () => {
							setPending(true);
							setError(false);
							try {
								await onAccept(replacement || undefined);
								onClose();
							} catch {
								setError(true);
							} finally {
								setPending(false);
							}
						}}
					>
						<Trans>Accept</Trans>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
