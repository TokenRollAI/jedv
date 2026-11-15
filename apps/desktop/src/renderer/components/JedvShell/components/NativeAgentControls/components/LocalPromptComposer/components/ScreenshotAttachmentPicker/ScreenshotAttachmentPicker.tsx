import { useFormat } from "@jedv/i18n/react";
import type { SelectScreenshot } from "@jedv/local-db";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	Copy,
	ExternalLink,
	FolderOpen,
	ImagePlus,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
export function ScreenshotAttachmentPicker({
	open,
	onOpenChange,
	onAdd,
	disabled,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	onAdd(file: { filename: string; base64: string }): void;
	disabled: boolean;
}) {
	const { t } = useLingui();
	const { formatDateTime } = useFormat();
	const [rows, setRows] = useState<SelectScreenshot[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [confirmClear, setConfirmClear] = useState(false);
	useEffect(() => {
		if (!open) return;
		setLoading(true);
		setError(null);
		const sub = electronTrpcClient.screenshots.onChanged.subscribe(undefined, {
			onData: (items) => {
				setRows(items);
				setLoading(false);
			},
			onError: (cause) => {
				setError(cause.message);
				setLoading(false);
			},
		});
		return () => sub.unsubscribe();
	}, [open]);
	const run = async (action: () => Promise<unknown>) => {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			const result = await action();
			if (
				result &&
				typeof result === "object" &&
				"success" in result &&
				result.success === false
			)
				throw new Error(
					t({ message: "The screenshot is no longer available." }),
				);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(false);
		}
	};
	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!pending) onOpenChange(value);
				}}
			>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>
							<Trans>Screenshots</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								Choose a saved screenshot to attach. Files are copied only when
								you submit the prompt.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-80 space-y-2 overflow-auto">
						{loading ? (
							<output className="text-xs text-muted-foreground">
								<Trans>Loading…</Trans>
							</output>
						) : !rows.length ? (
							<p className="py-8 text-center text-sm text-muted-foreground">
								<Trans>No screenshots yet</Trans>
							</p>
						) : (
							rows.map((row) => (
								<div
									key={row.id}
									className="flex items-center gap-2 rounded-md border p-2"
								>
									<button
										type="button"
										draggable
										className="h-14 w-20 shrink-0 overflow-hidden rounded"
										title={row.filename}
										onDragStart={() =>
											void run(() =>
												electronTrpcClient.screenshots.startDrag.mutate({
													id: row.id,
												}),
											)
										}
										onClick={() =>
											void run(() =>
												electronTrpcClient.screenshots.openFile.mutate({
													id: row.id,
												}),
											)
										}
									>
										<img
											src={row.thumbnail}
											alt={row.filename}
											className="h-full w-full object-contain"
										/>
									</button>
									<div className="min-w-0 flex-1">
										<p className="truncate text-xs" title={row.filename}>
											{row.filename}
										</p>
										<p className="text-[10px] text-muted-foreground">
											{formatDateTime(row.capturedAt)}
										</p>
										<div className="mt-1 flex gap-1">
											{[
												{
													icon: Copy,
													label: t({ message: "Copy image" }),
													action: () =>
														electronTrpcClient.screenshots.copy.mutate({
															id: row.id,
														}),
												},
												{
													icon: FolderOpen,
													label: t({ message: "Show in folder" }),
													action: () =>
														electronTrpcClient.screenshots.showInFolder.mutate({
															id: row.id,
														}),
												},
												{
													icon: ExternalLink,
													label: t({ message: "Open" }),
													action: () =>
														electronTrpcClient.screenshots.openFile.mutate({
															id: row.id,
														}),
												},
											].map(({ icon: Icon, label, action }) => (
												<Button
													key={label}
													variant="ghost"
													size="icon"
													className="size-6"
													disabled={pending}
													title={label}
													aria-label={label}
													onClick={() => void run(action)}
												>
													<Icon className="size-3.5" />
												</Button>
											))}
										</div>
									</div>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 gap-1 text-xs"
										disabled={pending || disabled}
										onClick={() =>
											void run(async () => {
												onAdd(
													await electronTrpcClient.screenshots.readPng.query({
														id: row.id,
													}),
												);
												onOpenChange(false);
											})
										}
									>
										<ImagePlus className="size-3.5" />
										<Trans>Attach</Trans>
									</Button>
								</div>
							))
						)}
					</div>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							disabled={pending || !rows.length}
							onClick={() => setConfirmClear(true)}
						>
							<Trash2 className="mr-1 size-3.5" />
							<Trans>Clear screenshots</Trans>
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={pending}
							onClick={() => onOpenChange(false)}
						>
							<Trans>Close</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog
				open={confirmClear}
				onOpenChange={(value) => {
					if (!pending) setConfirmClear(value);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							<Trans>Clear saved screenshots?</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								This removes all saved screenshots listed here. Attachments
								already copied into a workspace are kept.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					<ul className="max-h-40 overflow-auto text-xs">
						{rows.map((row) => (
							<li key={row.id}>{row.filename}</li>
						))}
					</ul>
					<DialogFooter>
						<Button
							autoFocus
							variant="outline"
							disabled={pending}
							onClick={() => setConfirmClear(false)}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							variant="destructive"
							disabled={pending}
							onClick={() =>
								void run(async () => {
									await electronTrpcClient.screenshots.clear.mutate();
									setConfirmClear(false);
								})
							}
						>
							<Trans>Clear screenshots</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
