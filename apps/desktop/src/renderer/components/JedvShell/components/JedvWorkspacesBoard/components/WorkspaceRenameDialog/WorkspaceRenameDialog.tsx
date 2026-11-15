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
import { useRef, useState } from "react";
import type { Workspace } from "../../../../types";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import { redactProjectError } from "../../../JedvProjectActions/project-utils";
export function WorkspaceRenameDialog({
	context,
	workspace,
	onChanged,
	onClose,
}: {
	context: ProjectActionContext;
	workspace: Workspace;
	onChanged(context: ProjectActionContext): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [target] = useState(() => ({ ...context }));
	const [name, setName] = useState(workspace.name || workspace.branch);
	const [pending, setPending] = useState(false);
	const [saved, setSaved] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Rename workspace</Trans>
					</DialogTitle>
					<DialogDescription>{target.hostLabel}</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						if (busy.current || !name.trim()) return;
						busy.current = true;
						setPending(true);
						setError(null);
						try {
							if (!saved) {
								await target.client.workspace.update.mutate({
									id: workspace.id,
									name: name.trim(),
								});
								setSaved(true);
							}
							await onChanged(target);
							onClose();
						} catch (failure) {
							setError(
								redactProjectError(
									failure instanceof Error
										? failure.message
										: t({ message: "Could not update workspace. Try again." }),
								),
							);
						} finally {
							busy.current = false;
							setPending(false);
						}
					}}
					className="space-y-4"
				>
					<Input
						aria-label={t({ message: "Workspace name" })}
						value={name}
						autoFocus
						disabled={pending || saved}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								(event.nativeEvent.isComposing ||
									event.nativeEvent.keyCode === 229)
							)
								event.preventDefault();
						}}
					/>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={pending}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={pending || !name.trim()}>
							{saved ? (
								<Trans>Finish refreshing</Trans>
							) : pending ? (
								<Trans>Saving…</Trans>
							) : (
								<Trans>Save</Trans>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
