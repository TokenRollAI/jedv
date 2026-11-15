import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@jedv/ui/alert-dialog";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { LocalClient } from "../../../../local-client";
import { CodeEditor } from "../../../JedvFilesView/components/CodeView/components/CodeEditor";

const EMPTY_CONFIG =
	"[setup]\nrun = []\n\n[terminals.dev]\nrun = []\ndefault = true\n";
export function ProjectScriptsDialog({
	client,
	hostUrl,
	projectId,
	onClose,
	onSaved,
	onReturnFocus,
}: {
	client: LocalClient;
	hostUrl: string;
	projectId: string;
	onClose(): void;
	onSaved(): void;
	onReturnFocus?(): void;
}) {
	const { t } = useLingui();
	const files = useQuery({
		queryKey: ["jedv", hostUrl, projectId, "config-files"],
		queryFn: () => client.config.getConfigFiles.query({ projectId }),
		retry: false,
	});
	const [target, setTarget] = useState<"shared" | "local">("shared");
	const [drafts, setDrafts] = useState<
		Partial<Record<"shared" | "local", string>>
	>({});
	const bases = useRef<
		Partial<
			Record<
				"shared" | "local",
				{ content: string | null; format: "toml" | "json" }
			>
		>
	>({});
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmClose, setConfirmClose] = useState(false);
	const source = target === "local" ? files.data?.local : files.data?.shared;
	const format =
		target === "local" ? "toml" : (files.data?.shared?.format ?? "toml");
	const original = (which: "shared" | "local") =>
		(which === "local"
			? files.data?.local.content
			: files.data?.shared?.content) ?? (which === "local" ? "" : EMPTY_CONFIG);
	const dirty = Object.entries(drafts).some(
		([key, value]) => value !== original(key as "shared" | "local"),
	);
	const save = async () => {
		if (!files.data || pending) return;
		setPending(true);
		setError(null);
		try {
			const fresh = await client.config.getConfigFiles.query({ projectId });
			const actual = target === "local" ? fresh.local : fresh.shared;
			const baseline = bases.current[target] ?? {
				content: source?.content ?? null,
				format,
			};
			if (
				(actual?.content ?? null) !== baseline.content ||
				(target === "shared" &&
					fresh.shared &&
					fresh.shared.format !== baseline.format)
			)
				throw new Error(
					t({ message: "File changed on disk. Reload before saving." }),
				);
			await client.config.writeConfigFile.mutate({
				projectId,
				file: target,
				format,
				content: drafts[target] ?? original(target),
			});
			await files.refetch();
			delete bases.current[target];
			setDrafts((previous) => {
				const next = { ...previous };
				delete next[target];
				return next;
			});
			onSaved();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(false);
		}
	};
	return (
		<>
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open && !pending) {
						if (dirty) setConfirmClose(true);
						else onClose();
					}
				}}
			>
				<DialogContent
					className="flex h-[min(640px,85vh)] max-w-3xl flex-col gap-3"
					onCloseAutoFocus={(event) => {
						if (!onReturnFocus) return;
						event.preventDefault();
						onReturnFocus();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Project scripts</Trans>
						</DialogTitle>
						<DialogDescription className="break-all text-xs">
							{source?.path ?? files.data?.tomlPath}
						</DialogDescription>
					</DialogHeader>
					<div className="flex gap-1 border-b border-border pb-2">
						<Button
							size="sm"
							variant={target === "shared" ? "secondary" : "ghost"}
							onClick={() => setTarget("shared")}
						>
							<Trans>Project</Trans>
						</Button>
						<Button
							size="sm"
							variant={target === "local" ? "secondary" : "ghost"}
							onClick={() => setTarget("local")}
						>
							<Trans>Personal</Trans>
						</Button>
						<span className="flex-1" />
						<Button
							size="sm"
							disabled={
								pending ||
								drafts[target] === undefined ||
								drafts[target] === original(target)
							}
							onClick={() => void save()}
						>
							<Trans>Save</Trans>
						</Button>
					</div>
					{(files.error || error) && (
						<p role="alert" className="text-xs text-destructive">
							{error ?? files.error?.message}
						</p>
					)}
					{files.data && (
						<div className="min-h-0 flex-1 overflow-hidden rounded border border-border">
							<CodeEditor
								value={drafts[target] ?? original(target)}
								language={format}
								filePath={source?.path ?? files.data.tomlPath}
								onChange={(value) => {
									if (!bases.current[target])
										bases.current[target] = {
											content: source?.content ?? null,
											format,
										};
									setDrafts((previous) => ({ ...previous, [target]: value }));
								}}
								onSave={() => void save()}
							/>
						</div>
					)}
				</DialogContent>
			</Dialog>
			<AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Discard unsaved changes?</Trans>
						</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction onClick={onClose}>
							<Trans>Confirm</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
