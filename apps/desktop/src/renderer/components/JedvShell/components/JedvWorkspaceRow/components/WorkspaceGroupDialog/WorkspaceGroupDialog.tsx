import { normalizeWorkspaceTag } from "@jedv/shared/workspace-tags";
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
import { Label } from "@jedv/ui/label";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { ColorSelector } from "renderer/components/ColorSelector";
import { PROJECT_COLOR_DEFAULT } from "shared/constants/project-colors";
import type { ProjectActionContext } from "../../../JedvProjectActions";
export function WorkspaceGroupDialog({
	context,
	projectId,
	initial,
	onChanged,
	onClose,
}: {
	context: ProjectActionContext;
	projectId: string;
	initial?: { tag: string; name: string; color: string | null; order?: number };
	onChanged(context: ProjectActionContext): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const [target] = useState(() => ({ ...context }));
	const [name, setName] = useState(initial?.name ?? "");
	const [color, setColor] = useState(initial?.color ?? null);
	const [pending, setPending] = useState(false);
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
			<DialogContent className="sm:max-w-[420px]" showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>
						{initial ? <Trans>Edit group</Trans> : <Trans>New group</Trans>}
					</DialogTitle>
					<DialogDescription>
						<Trans>Groups use workspace tags on the target host.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (busy.current) return;
						const tag = initial?.tag ?? normalizeWorkspaceTag(name);
						if (!tag) {
							setError(
								t({ message: "Enter a group name of 1 to 64 characters." }),
							);
							return;
						}
						busy.current = true;
						setPending(true);
						setError(null);
						try {
							await target.client.tagFolders.upsert.mutate({
								scope: projectId,
								tag,
								displayName: name.trim(),
								color,
								tabOrder: initial?.order,
							});
							await onChanged(target);
							onClose();
						} catch {
							setError(
								t({ message: "Could not save the group. Your draft is kept." }),
							);
						} finally {
							busy.current = false;
							setPending(false);
						}
					}}
				>
					<div className="space-y-1.5">
						<Label htmlFor={id}>
							<Trans>Group name</Trans>
						</Label>
						<Input
							id={id}
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={pending}
							autoFocus
						/>
					</div>
					<ColorSelector
						includeDefault
						selectedColor={color}
						disabled={pending}
						onSelectColor={(value) =>
							setColor(value === PROJECT_COLOR_DEFAULT ? null : value)
						}
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
							<Trans>Save group</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
