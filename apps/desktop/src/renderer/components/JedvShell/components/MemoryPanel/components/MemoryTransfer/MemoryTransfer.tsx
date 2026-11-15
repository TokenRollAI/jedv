import { memoryTransferSchema } from "@jedv/shared/memory";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@jedv/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { LuDownload, LuUpload } from "react-icons/lu";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import type { MemoryPanelProps, MemoryScopeOption } from "../../types";
export function MemoryTransfer({
	client,
	scope,
	disabled,
	canExport,
	onChanged,
}: Pick<MemoryPanelProps, "client" | "hostUrl"> & {
	scope: MemoryScopeOption;
	disabled: boolean;
	canExport: boolean;
	onChanged(): Promise<void>;
}) {
	const { t } = useLingui();
	const pathId = useId();
	const file = useRef<HTMLInputElement>(null),
		busy = useRef(false);
	const [pending, setPending] = useState(false),
		[error, setError] = useState<string | null>(null),
		[notice, setNotice] = useState<string | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [pathDialog, setPathDialog] = useState(false),
		[path, setPath] = useState(".jedv/memory.json");
	const target = { scopeKind: scope.scopeKind, scopeId: scope.scopeId };
	const run = async (work: () => Promise<void>) => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		setNotice(null);
		try {
			await work();
		} catch {
			setError(t({ message: "Memory action failed" }));
			throw new Error("Memory transfer failed");
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const download = () =>
		void run(async () => {
			const data = await client.memory.exportData.query(target);
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `jedv-memory-${scope.scopeKind}.json`;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
		}).catch(() => {});
	const selectFile = async (selected: File) => {
		setError(null);
		setNotice(null);
		if (selected.size > 4 * 1024 * 1024) {
			setError(t({ message: "Memory JSON must be at most 4 MB." }));
			return;
		}
		try {
			const data = memoryTransferSchema.parse(
				JSON.parse(await selected.text()),
			);
			setConfirmation({
				title: t({ message: "Import memory?" }),
				description: t({
					message:
						"Imported entries stay in the selected scope. Existing content is deduplicated.",
				}),
				detail: `${scope.label}\n${selected.name}\n${data.entries.length}`,
				execute: () =>
					run(async () => {
						await client.memory.importData.mutate({ scope: target, data });
						await onChanged();
						setNotice(t({ message: "Memory imported" }));
					}),
			});
		} catch {
			setError(t({ message: "Invalid memory JSON" }));
		}
	};
	const exportProject = () =>
		setConfirmation({
			title: t({ message: "Export project memory?" }),
			description: t({
				message:
					"This writes .jedv/memory.json on the target host and replaces the existing file.",
			}),
			detail: scope.label,
			execute: () =>
				run(async () => {
					const result = await client.memory.exportProject.mutate({
						projectId: scope.scopeId,
					});
					setNotice(result.filePath);
				}),
		});
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={t({ message: "Export memory" })}
						title={t({ message: "Export memory" })}
						disabled={!canExport || pending}
						className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
					>
						<LuDownload className="size-3.5" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={download}>
						<Trans>Download JSON</Trans>
					</DropdownMenuItem>
					{scope.scopeKind === "project" && (
						<DropdownMenuItem disabled={disabled} onSelect={exportProject}>
							<Trans>Export to .jedv/memory.json</Trans>
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={t({ message: "Import memory" })}
						title={t({ message: "Import memory" })}
						disabled={disabled || pending}
						className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
					>
						<LuUpload className="size-3.5" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => file.current?.click()}>
						<Trans>Import JSON file</Trans>
					</DropdownMenuItem>
					{scope.scopeKind === "project" && (
						<DropdownMenuItem onSelect={() => setPathDialog(true)}>
							<Trans>Import from host file</Trans>
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			<input
				ref={file}
				type="file"
				accept=".json,application/json"
				aria-label={t({ message: "Import JSON file" })}
				className="hidden"
				disabled={disabled || pending}
				onChange={(event) => {
					const selected = event.target.files?.[0];
					event.target.value = "";
					if (selected) void selectFile(selected);
				}}
			/>
			{error && (
				<p role="alert" className="basis-full text-xs text-destructive">
					{error}
				</p>
			)}
			{notice && (
				<output className="basis-full break-all text-[11px] text-muted-foreground">
					{notice}
				</output>
			)}
			{confirmation && !disabled && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
			{pathDialog && !disabled && (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open && !pending) setPathDialog(false);
					}}
				>
					<DialogContent
						onEscapeKeyDown={(event) => {
							if (pending) event.preventDefault();
						}}
					>
						<DialogTitle>
							<Trans>Import from host file</Trans>
						</DialogTitle>
						<DialogDescription>{scope.label}</DialogDescription>
						<form
							className="space-y-3"
							onSubmit={async (event) => {
								event.preventDefault();
								if (pending || !path.trim()) return;
								try {
									await run(async () => {
										await client.memory.importProject.mutate({
											projectId: scope.scopeId,
											filePath: path.trim(),
										});
										await onChanged();
										setNotice(t({ message: "Memory imported" }));
									});
									setPathDialog(false);
								} catch {
									/* Keep the host path for retry. */
								}
							}}
						>
							<label htmlFor={pathId} className="block space-y-1 text-xs">
								<span>
									<Trans>File path on target host</Trans>
								</span>
								<Input
									id={pathId}
									autoFocus
									value={path}
									disabled={pending}
									onChange={(event) => setPath(event.target.value)}
								/>
							</label>
							{error && (
								<p role="alert" className="text-xs text-destructive">
									{error}
								</p>
							)}
							<div className="flex justify-end gap-2">
								<Button
									variant="ghost"
									type="button"
									disabled={pending}
									onClick={() => setPathDialog(false)}
								>
									<Trans>Cancel</Trans>
								</Button>
								<Button type="submit" disabled={pending || !path.trim()}>
									<Trans>Import</Trans>
								</Button>
							</div>
						</form>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
