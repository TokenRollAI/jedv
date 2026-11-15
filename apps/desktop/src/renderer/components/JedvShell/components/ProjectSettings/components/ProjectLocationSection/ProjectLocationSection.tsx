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
import { useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	HostDirectoryPicker,
	type ProjectActionContext,
} from "../../../JedvProjectActions";
import { redactProjectError } from "../../../JedvProjectActions/project-utils";
export function ProjectLocationSection({
	context,
	projectId,
	currentPath,
	repoUrl,
	onChanged,
}: {
	context: ProjectActionContext;
	projectId: string;
	currentPath: string;
	repoUrl: string | null;
	onChanged(): Promise<void>;
}) {
	const { t } = useLingui();
	const [target] = useState(() => ({ ...context }));
	const [browse, setBrowse] = useState(false);
	const [proposed, setProposed] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const propose = (path: string) => {
		if (path !== currentPath) {
			setProposed(path);
			setError(null);
			setSaved(false);
		}
	};
	return (
		<div className="space-y-2">
			<div className="flex items-start gap-2">
				<p className="min-w-0 flex-1 break-all font-mono text-xs">
					{currentPath}
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={pending}
					onClick={async () => {
						if (target.isRemote) {
							setBrowse(true);
							return;
						}
						try {
							const picked =
								await electronTrpcClient.window.selectDirectory.mutate({
									title: t({ message: "Select new project location" }),
									defaultPath: currentPath,
								});
							if (!picked.canceled && picked.path) propose(picked.path);
						} catch {
							setError(t({ message: "Could not select a project directory." }));
						}
					}}
				>
					<Trans>Change location…</Trans>
				</Button>
			</div>
			{error && !proposed && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			{browse && (
				<HostDirectoryPicker
					context={target}
					initialPath={currentPath}
					onClose={() => setBrowse(false)}
					onSelect={(path) => {
						setBrowse(false);
						propose(path);
					}}
				/>
			)}
			{proposed && (
				<Dialog
					open
					modal
					onOpenChange={(open) => {
						if (!open && !busy.current) setProposed(null);
					}}
				>
					<DialogContent showCloseButton={!pending}>
						<DialogHeader>
							<DialogTitle>
								<Trans>Relocate project?</Trans>
							</DialogTitle>
							<DialogDescription>
								<Trans>
									Use an existing repository at this location. Jedv changes the
									registered path and local checkout workspaces; it does not
									move files. Existing worktrees under the old repository may
									need to be imported again.
								</Trans>
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 text-xs">
							<div>
								<p className="text-muted-foreground">
									<Trans>From</Trans>
								</p>
								<p className="break-all font-mono">{currentPath}</p>
							</div>
							<div>
								<p className="text-muted-foreground">
									<Trans>To</Trans>
								</p>
								<p className="break-all font-mono">{proposed}</p>
							</div>
						</div>
						{error && (
							<p role="alert" className="break-words text-xs text-destructive">
								{error}
							</p>
						)}
						<DialogFooter>
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() => setProposed(null)}
							>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								disabled={pending}
								onClick={async () => {
									if (busy.current) return;
									busy.current = true;
									setPending(true);
									setError(null);
									try {
										if (!saved) {
											await target.client.project.setup.mutate({
												projectId,
												origin: repoUrl ? { repoCloneUrl: repoUrl } : undefined,
												mode: {
													kind: "import",
													repoPath: proposed,
													allowRelocate: true,
												},
											});
											setSaved(true);
										}
										await onChanged();
										setProposed(null);
									} catch (failure) {
										setError(
											redactProjectError(
												failure instanceof Error
													? failure.message
													: t({
															message:
																"Could not change the project location. Your files have not been moved.",
														}),
											),
										);
									} finally {
										busy.current = false;
										setPending(false);
									}
								}}
							>
								{pending ? (
									<Trans>Relocating…</Trans>
								) : saved ? (
									<Trans>Finish refreshing</Trans>
								) : (
									<Trans>Relocate</Trans>
								)}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
