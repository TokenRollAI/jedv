import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import type { Workspace } from "../../../../types";
import type { ProjectActionContext } from "../../../JedvProjectActions";
export interface ActiveWorkspaceItem {
	workspace: Workspace;
	status: "permission" | "failed" | "review" | "working";
	unread?: boolean;
}
export function ActiveWorkspaceSwitcher({
	context,
	items,
	onOpen,
	onClose,
}: {
	context: ProjectActionContext;
	items: ActiveWorkspaceItem[];
	onOpen(result: {
		context: ProjectActionContext;
		workspaceId: string;
	}): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [target] = useState(() => ({ ...context }));
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const rank = { permission: 0, failed: 1, review: 2, working: 3 };
	const ordered = [...items]
		.filter((item) => item.workspace.archivedAt == null)
		.sort((a, b) => rank[a.status] - rank[b.status]);
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent className="p-0 sm:max-w-lg" showCloseButton={!pending}>
				<DialogHeader className="px-4 pt-4">
					<DialogTitle>
						<Trans>Active workspaces</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Jump to a workspace that needs attention or is running.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<Command>
					<CommandInput
						disabled={pending}
						placeholder={t({ message: "Search active workspaces…" })}
					/>
					<CommandList className="max-h-80">
						<CommandEmpty>
							<Trans>No active workspaces</Trans>
						</CommandEmpty>
						{ordered.map((item) => (
							<CommandItem
								key={item.workspace.id}
								value={`${item.workspace.id} ${item.workspace.name} ${item.workspace.branch}`}
								disabled={pending}
								onSelect={async () => {
									if (busy.current) return;
									busy.current = true;
									setPending(true);
									setError(null);
									try {
										await onOpen({
											context: target,
											workspaceId: item.workspace.id,
										});
										onClose();
									} catch {
										setError(
											t({
												message:
													"Could not open this workspace. Check the target host and try again.",
											}),
										);
									} finally {
										busy.current = false;
										setPending(false);
									}
								}}
							>
								<span className="min-w-0 flex-1 truncate">
									{item.workspace.name || item.workspace.branch}
								</span>
								<span className="text-xs text-muted-foreground">
									{item.status === "permission" ? (
										<Trans>Approval needed</Trans>
									) : item.status === "failed" ? (
										<Trans>Failed</Trans>
									) : item.status === "review" ? (
										<Trans>Finished</Trans>
									) : (
										<Trans>Working</Trans>
									)}
								</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
				{error && (
					<p role="alert" className="px-4 pb-3 text-xs text-destructive">
						{error}
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
