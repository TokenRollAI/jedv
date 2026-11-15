import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { LuFolderOpen } from "react-icons/lu";
import type { ProjectDraft } from "../types";
export function FolderProjectForm({
	draft,
	disabled,
	onChange,
	onBrowse,
}: {
	draft: ProjectDraft;
	disabled: boolean;
	onChange(draft: ProjectDraft): void;
	onBrowse(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	return (
		<div className="space-y-3">
			<label htmlFor={`${id}-name`} className="block space-y-1 text-xs">
				<span>
					<Trans>Project name</Trans>
				</span>
				<Input
					id={`${id}-name`}
					value={draft.name}
					disabled={disabled}
					onChange={(event) =>
						onChange({ ...draft, name: event.target.value, nameTouched: true })
					}
				/>
			</label>
			<label htmlFor={`${id}-path`} className="block space-y-1 text-xs">
				<span>
					<Trans>Project directory</Trans>
				</span>
			</label>
			<div className="flex gap-1.5">
				<Input
					id={`${id}-path`}
					autoFocus
					value={draft.repoPath}
					disabled={disabled}
					onChange={(event) =>
						onChange({
							...draft,
							repoPath: event.target.value,
							name: draft.nameTouched
								? draft.name
								: (event.target.value
										.replace(/[\\/]+$/, "")
										.split(/[\\/]/)
										.at(-1) ?? ""),
						})
					}
					className="min-w-0 flex-1 font-mono text-xs"
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label={t({ message: "Browse for directory" })}
					disabled={disabled}
					onClick={onBrowse}
				>
					<LuFolderOpen className="size-4" />
				</Button>
			</div>
		</div>
	);
}
