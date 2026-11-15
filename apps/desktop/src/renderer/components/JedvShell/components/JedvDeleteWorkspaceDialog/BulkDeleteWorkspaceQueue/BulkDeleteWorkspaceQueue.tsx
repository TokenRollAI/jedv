import { Button } from "@jedv/ui/button";
import { Checkbox } from "@jedv/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";
import type { Workspace } from "../../../types";
import type { ProjectActionContext } from "../../JedvProjectActions";
import {
	type DeletedWorkspaceResult,
	JedvDeleteWorkspaceDialog,
} from "../JedvDeleteWorkspaceDialog";
export function BulkDeleteWorkspaceQueue({
	context,
	workspaces,
	hasUnsavedFiles,
	onRefresh,
	onDeleted,
	onClose,
}: {
	context: ProjectActionContext;
	workspaces: Workspace[];
	hasUnsavedFiles(workspaceId: string): boolean;
	onRefresh(context: ProjectActionContext): Promise<void>;
	onDeleted(result: DeletedWorkspaceResult): Promise<void> | void;
	onClose(): void;
}) {
	const [target] = useState(() => ({ ...context }));
	const [candidates] = useState(() =>
		workspaces.filter((row) => row.archivedAt == null),
	);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [queue, setQueue] = useState<Workspace[] | null>(null);
	const advanced = useRef(new Set<string>());
	const [results, setResults] = useState<Record<string, "deleted" | "skipped">>(
		{},
	);
	const advance = (workspace: Workspace, status: "deleted" | "skipped") => {
		if (advanced.current.has(workspace.id)) return;
		advanced.current.add(workspace.id);
		setResults((previous) => ({ ...previous, [workspace.id]: status }));
		setQueue((previous) => previous?.slice(1) ?? []);
	};
	const current = queue?.[0];
	if (current)
		return (
			<JedvDeleteWorkspaceDialog
				key={current.id}
				context={target}
				workspace={current}
				hasUnsavedFiles={hasUnsavedFiles(current.id)}
				getHasUnsavedFiles={() => hasUnsavedFiles(current.id)}
				onRefresh={onRefresh}
				onDeleted={async (result) => {
					await onDeleted(result);
					advance(current, "deleted");
				}}
				onClose={() => {
					if (!results[current.id]) advance(current, "skipped");
				}}
			/>
		);
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{queue ? (
							<Trans>Workspace deletion results</Trans>
						) : (
							<Trans>Delete multiple workspaces</Trans>
						)}
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Select only the workspaces you intend to remove. Each selected
							workspace receives its own current-state inspection and
							destructive confirmation. Cancelling one skips it.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-80 space-y-2 overflow-y-auto">
					{candidates.map((workspace) => (
						<div
							key={workspace.id}
							className="flex items-center gap-2 rounded border p-2 text-xs"
						>
							{queue === null && (
								<Checkbox
									aria-label={workspace.name || workspace.branch}
									checked={selected.has(workspace.id)}
									disabled={hasUnsavedFiles(workspace.id)}
									onCheckedChange={(value) =>
										setSelected((previous) => {
											const next = new Set(previous);
											if (value === true) next.add(workspace.id);
											else next.delete(workspace.id);
											return next;
										})
									}
								/>
							)}
							<span className="min-w-0 flex-1 truncate">
								{workspace.name || workspace.branch}
							</span>
							{hasUnsavedFiles(workspace.id) && (
								<span className="text-destructive">
									<Trans>Unsaved files</Trans>
								</span>
							)}
							{results[workspace.id] === "deleted" ? (
								<span>
									<Trans>Deleted</Trans>
								</span>
							) : results[workspace.id] === "skipped" ? (
								<span>
									<Trans>Skipped</Trans>
								</span>
							) : null}
						</div>
					))}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{queue ? <Trans>Done</Trans> : <Trans>Cancel</Trans>}
					</Button>
					{queue === null && (
						<Button
							variant="destructive"
							disabled={selected.size === 0}
							onClick={() =>
								setQueue(candidates.filter((row) => selected.has(row.id)))
							}
						>
							<Trans>Review selected workspaces</Trans>
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
