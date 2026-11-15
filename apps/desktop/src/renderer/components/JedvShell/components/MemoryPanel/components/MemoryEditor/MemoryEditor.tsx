import type { MemoryPut } from "@jedv/shared/memory";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { JedvSelect } from "../../../JedvSelect";
import type { MemoryItem, MemoryScopeOption } from "../../types";
export function MemoryEditor({
	scope,
	initial,
	onSave,
	onClose,
	disabled = false,
}: {
	scope: MemoryScopeOption;
	initial?: MemoryItem;
	onSave(input: MemoryPut): Promise<void>;
	onClose(): void;
	disabled?: boolean;
}) {
	const { t } = useLingui();
	const titleId = useId();
	const [title, setTitle] = useState(initial?.title ?? ""),
		[content, setContent] = useState(initial?.content ?? "");
	const [tier, setTier] = useState<MemoryItem["tier"]>(initial?.tier ?? "core"),
		[category, setCategory] = useState<MemoryItem["category"]>(
			initial?.category ?? "context",
		);
	const [pending, setPending] = useState(false),
		[error, setError] = useState(false);
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
					{initial
						? t({ message: "Edit memory" })
						: t({ message: "Add memory" })}
				</DialogTitle>
				<DialogDescription>
					{scope.label}
					{initial && (
						<>
							{" "}
							·{" "}
							<Trans>
								Saving replaces the current entry and keeps its history.
							</Trans>
						</>
					)}
				</DialogDescription>
				<form
					className="space-y-3"
					onSubmit={async (event) => {
						event.preventDefault();
						if (disabled || pending || !title.trim() || !content.trim()) return;
						setPending(true);
						setError(false);
						try {
							await onSave({
								scopeKind: scope.scopeKind,
								scopeId: scope.scopeId,
								title: title.trim(),
								content: content.trim(),
								tier,
								category,
								sourceKind: "human",
								supersedeId: initial?.id,
							});
							onClose();
						} catch {
							setError(true);
						} finally {
							setPending(false);
						}
					}}
				>
					<label htmlFor={titleId} className="block space-y-1 text-xs">
						<span>
							<Trans>Title</Trans>
						</span>
						<Input
							id={titleId}
							autoFocus
							maxLength={300}
							value={title}
							disabled={pending || disabled}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<label className="block space-y-1 text-xs">
						<span>
							<Trans>Content</Trans>
						</span>
						<textarea
							maxLength={32_000}
							rows={7}
							value={content}
							disabled={pending || disabled}
							onChange={(event) => setContent(event.target.value)}
							className="block w-full resize-y rounded-md border border-input bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</label>
					<div className="flex flex-wrap gap-3">
						<label htmlFor={`${titleId}-tier`} className="space-x-2 text-xs">
							<span>
								<Trans>Tier</Trans>
							</span>
							<JedvSelect
								id={`${titleId}-tier`}
								label={t({ message: "Tier" })}
								value={tier}
								onValueChange={(value) => {
									if (value === "core" || value === "archival") setTier(value);
								}}
								disabled={pending || disabled}
								options={[
									{ value: "core", label: t({ message: "Core" }) },
									{ value: "archival", label: t({ message: "Archival" }) },
								]}
								className="w-auto"
							/>
						</label>
						<label
							htmlFor={`${titleId}-category`}
							className="space-x-2 text-xs"
						>
							<span>
								<Trans>Category</Trans>
							</span>
							<JedvSelect
								id={`${titleId}-category`}
								label={t({ message: "Category" })}
								value={category}
								onValueChange={(value) => {
									if (
										value === "context" ||
										value === "convention" ||
										value === "correction" ||
										value === "pitfall" ||
										value === "summary"
									)
										setCategory(value);
								}}
								disabled={pending || disabled}
								options={[
									{ value: "context", label: t({ message: "Context" }) },
									{ value: "convention", label: t({ message: "Convention" }) },
									{ value: "correction", label: t({ message: "Correction" }) },
									{ value: "pitfall", label: t({ message: "Pitfall" }) },
									{ value: "summary", label: t({ message: "Summary" }) },
								]}
								className="w-auto"
							/>
						</label>
					</div>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							<Trans>Could not save memory. Your draft is kept.</Trans>
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							disabled={pending}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							type="submit"
							disabled={disabled || pending || !title.trim() || !content.trim()}
						>
							<Trans>Save</Trans>
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
