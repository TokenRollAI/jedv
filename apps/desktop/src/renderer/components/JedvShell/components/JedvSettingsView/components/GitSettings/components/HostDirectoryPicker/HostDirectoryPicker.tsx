import { errorMessage } from "@jedv/i18n/errors";
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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { LocalClient } from "../../../../../../local-client";

export function HostDirectoryPicker({
	client,
	hostUrl,
	initialPath,
	onChoose,
	onClose,
}: {
	client: LocalClient;
	hostUrl: string;
	initialPath: string;
	onChoose(path: string): void;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [path, setPath] = useState(initialPath);
	const [entry, setEntry] = useState(initialPath);
	const query = useQuery({
		queryKey: ["jedv-settings", hostUrl, "browse-directory", path],
		queryFn: () =>
			client.filesystem.browseHost.query({ path: path || undefined }),
	});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Choose a folder on the connected host</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Changing this location affects new worktrees. Existing folders are
							not moved.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setPath(entry);
					}}
				>
					<Input
						aria-label={t({ message: "Directory path" })}
						value={entry}
						onChange={(event) => setEntry(event.target.value)}
					/>
					<Button variant="outline" disabled={query.isFetching}>
						<Trans>Go</Trans>
					</Button>
				</form>
				{query.error && (
					<p role="alert" className="text-xs text-destructive">
						{errorMessage(query.error)}
						<Button
							size="sm"
							variant="ghost"
							onClick={() => void query.refetch()}
						>
							<Trans>Retry</Trans>
						</Button>
					</p>
				)}
				{query.isFetching && (
					<output className="text-xs text-muted-foreground">
						<Trans>Loading…</Trans>
					</output>
				)}
				<div className="max-h-64 overflow-auto rounded border border-border p-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={!query.data?.parentPath || query.isFetching}
						onClick={() => {
							const next = query.data?.parentPath;
							if (next) {
								setPath(next);
								setEntry(next);
							}
						}}
					>
						<Trans>Parent folder</Trans>
					</Button>
					{query.data?.entries
						.filter((entry) => entry.isDirectory)
						.map((entry) => (
							<Button
								key={entry.name}
								variant="ghost"
								size="sm"
								className="w-full justify-start font-mono"
								disabled={query.isFetching}
								onClick={() => {
									if (!query.data) return;
									const next = `${query.data.path.replace(/\/$/, "")}/${entry.name}`;
									setPath(next);
									setEntry(next);
								}}
							>
								{entry.name}
							</Button>
						))}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={!query.data || query.isFetching || !!query.error}
						onClick={() => {
							if (query.data) onChoose(query.data.path);
						}}
					>
						<Trans>Use this folder</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
