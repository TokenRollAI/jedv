import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Label } from "@jedv/ui/label";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { LuFolderOpen } from "react-icons/lu";
import { GitHubRepositoryPicker } from "../GitHubRepositoryPicker";
import { ProjectFields } from "../ProjectFields";
import {
	deriveProjectNameFromUrl,
	directoryNameForProject,
	joinProjectPath,
} from "../project-utils";
import type {
	ProjectActionContext,
	ProjectActionKind,
	ProjectDraft,
} from "../types";

export function ProjectForm({
	kind,
	context,
	draft,
	disabled,
	onChange,
	onBrowse,
}: {
	kind: ProjectActionKind;
	context: ProjectActionContext;
	draft: ProjectDraft;
	disabled: boolean;
	onChange(draft: ProjectDraft): void;
	onBrowse(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const [selectedRepository, setSelectedRepository] = useState<string | null>(
		null,
	);
	const setUrl = (url: string) =>
		onChange({
			...draft,
			url,
			name: draft.nameTouched ? draft.name : deriveProjectNameFromUrl(url),
		});
	if (kind === "open")
		return (
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={id} className="text-xs">
					<Trans>Project directory</Trans>
				</Label>
				<div className="flex gap-1.5">
					<Input
						id={id}
						autoFocus
						className="min-w-0 flex-1 font-mono text-xs"
						value={draft.repoPath}
						disabled={disabled}
						onChange={(event) =>
							onChange({ ...draft, repoPath: event.target.value })
						}
						placeholder="/path/to/project"
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={disabled}
						onClick={onBrowse}
						aria-label={t({ message: "Browse for directory" })}
					>
						<LuFolderOpen className="size-4" />
					</Button>
				</div>
			</div>
		);
	return (
		<>
			{kind === "clone" && (
				<>
					<GitHubRepositoryPicker
						context={context}
						disabled={disabled}
						selectedFullName={selectedRepository}
						onSelect={(repo) => {
							setSelectedRepository(repo.fullName);
							setUrl(repo.cloneUrl);
						}}
					/>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={id} className="text-xs">
							<Trans>Repository URL or path</Trans>
						</Label>
						<Input
							id={id}
							value={draft.url}
							onChange={(event) => {
								setSelectedRepository(null);
								setUrl(event.target.value);
							}}
							disabled={disabled}
							placeholder={t({
								message: "https://github.com/owner/repo.git or /path/to/repo",
							})}
							autoFocus
						/>
					</div>
				</>
			)}
			<ProjectFields
				autoFocusName={kind !== "clone"}
				name={draft.name}
				parentDir={draft.parentDir}
				disabled={disabled}
				onName={(name) => onChange({ ...draft, name, nameTouched: true })}
				onParent={(parentDir) => onChange({ ...draft, parentDir })}
				onBrowse={onBrowse}
			/>
			{!!draft.parentDir && !!draft.name && (
				<p className="break-all font-mono text-[11px] text-muted-foreground">
					{joinProjectPath(
						draft.parentDir,
						kind === "clone"
							? deriveProjectNameFromUrl(draft.url)
							: directoryNameForProject(draft.name),
					)}
				</p>
			)}
		</>
	);
}
