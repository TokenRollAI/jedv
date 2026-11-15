import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
	HostDirectoryPicker,
	type ProjectActionContext,
} from "../../../JedvProjectActions";
export function WorktreeLocationSection({
	projectId,
	currentPath,
	context,
	onChanged,
}: {
	projectId: string;
	currentPath: string | null;
	context: ProjectActionContext;
	onChanged(): Promise<void>;
}) {
	const { t } = useLingui();
	const [value, setValue] = useState(currentPath ?? "");
	const [browse, setBrowse] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async (path: string | null) => {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			await context.client.project.setWorktreeBaseDir.mutate({
				projectId,
				path,
			});
			setValue(path ?? "");
			await onChanged();
		} catch {
			setError(
				t({
					message:
						"Could not save worktree location. Your previous setting is unchanged unless the host already saved this request.",
				}),
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<Input
					aria-label={t({ message: "Worktree base directory" })}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					disabled={pending}
					placeholder={t({ message: "Use host default" })}
					className="font-mono text-xs"
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={pending}
					onClick={() => setBrowse(true)}
				>
					<Trans>Browse</Trans>
				</Button>
			</div>
			<div className="flex gap-2">
				<Button
					size="sm"
					disabled={pending || value.trim() === (currentPath ?? "")}
					onClick={() => void save(value.trim() || null)}
				>
					<Trans>Save</Trans>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={pending || !currentPath}
					onClick={() => void save(null)}
				>
					<Trans>Use host default</Trans>
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				<Trans>
					Only new worktrees use this location. Existing worktrees are not
					moved.
				</Trans>
			</p>
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			{browse && (
				<HostDirectoryPicker
					context={context}
					initialPath={value || undefined}
					onClose={() => setBrowse(false)}
					onSelect={(path) => {
						setValue(path);
						setBrowse(false);
					}}
				/>
			)}
		</div>
	);
}
