import { Input } from "@jedv/ui/input";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { HiChevronRight, HiMiniPlus } from "react-icons/hi2";
import {
	LuCopy,
	LuFolderInput,
	LuFolderOpen,
	LuFolderPlus,
	LuImage,
	LuMonitor,
	LuPencil,
	LuSettings,
	LuTrash2,
} from "react-icons/lu";
import type { Project } from "../../types";
import {
	type ProjectRowAction,
	ProjectRowMenu,
} from "../JedvProjectActions/ProjectRowMenu";
import { ProjectThumbnail } from "../JedvProjectActions/ProjectThumbnail";
import { resolveProjectIconUrl } from "../JedvProjectActions/project-icon";

export function JedvProjectRow({
	project,
	collapsed,
	onToggle,
	onNew,
	onCheckout,
	onRename,
	onCopy,
	onFinder,
	onRemove,
	onSettings,
	onCreateGroup,
	onImportWorktrees,
	onOpenEditor,
	onAppearance,
	disabled = false,
}: {
	project: Project;
	collapsed: boolean;
	onToggle(): void;
	onNew(): void;
	onCheckout(): void;
	onRename(name: string): void | Promise<void>;
	onCopy(): void;
	onFinder?: () => void;
	onRemove(): void;
	onSettings?: () => void;
	onCreateGroup?: () => void;
	onImportWorktrees?: () => void;
	onOpenEditor?: () => void;
	onAppearance?: () => void;
	disabled?: boolean;
}) {
	const { t } = useLingui();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(project.name);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const toggle = useRef<HTMLButtonElement>(null);
	const committing = useRef(false);
	const cancelled = useRef(false);
	const startRename = () => {
		cancelled.current = false;
		if (!error) setName(project.name);
		setError(null);
		setEditing(true);
	};
	const finishRename = async (restoreFocus = false) => {
		if (committing.current) return;
		if (!name.trim()) {
			setEditing(false);
			return;
		}
		if (name.trim() === project.name) {
			setEditing(false);
			if (restoreFocus) requestAnimationFrame(() => toggle.current?.focus());
			return;
		}
		committing.current = true;
		setSaving(true);
		setError(null);
		try {
			await onRename(name.trim());
			setEditing(false);
			if (restoreFocus) requestAnimationFrame(() => toggle.current?.focus());
		} catch {
			setError(t({ message: "Could not rename project. Try again." }));
		} finally {
			committing.current = false;
			setSaving(false);
		}
	};
	const actions: ProjectRowAction[] = [
		{
			label: t({ message: "New workspace" }),
			icon: LuFolderPlus,
			run: onNew,
			disabled,
		},
		{
			label: t({ message: "Open local checkout" }),
			icon: LuFolderOpen,
			run: onCheckout,
			disabled,
		},
		{
			label: t({ message: "Rename" }),
			icon: LuPencil,
			run: startRename,
			disabled: disabled || saving,
			separator: true,
		},
		...(onAppearance
			? [
					{
						label: t({ message: "Project icon and color" }),
						icon: LuImage,
						run: onAppearance,
						disabled,
					},
				]
			: []),
		...(onFinder
			? [
					{
						label: t({ message: "Open in Finder" }),
						icon: LuFolderOpen,
						run: onFinder,
						disabled,
						separator: true,
					},
				]
			: []),
		...(onOpenEditor
			? [
					{
						label: t({ message: "Open in external editor" }),
						icon: LuMonitor,
						run: onOpenEditor,
						disabled,
					},
				]
			: []),
		...(onSettings
			? [
					{
						label: t({ message: "Project Settings" }),
						icon: LuSettings,
						run: onSettings,
						disabled,
					},
				]
			: []),
		...(onCreateGroup
			? [
					{
						label: t({ message: "New group" }),
						icon: LuFolderPlus,
						run: onCreateGroup,
						disabled,
					},
				]
			: []),
		...(onImportWorktrees
			? [
					{
						label: t({ message: "Import untracked worktrees" }),
						icon: LuFolderInput,
						run: onImportWorktrees,
						disabled,
					},
				]
			: []),
		{ label: t({ message: "Copy Path" }), icon: LuCopy, run: onCopy, disabled },
		{
			label: t({ message: "Remove from Jedv…" }),
			icon: LuTrash2,
			run: onRemove,
			destructive: true,
			disabled,
			separator: true,
		},
	];
	return (
		<div>
			<ProjectRowMenu
				actions={
					editing
						? actions.map((action) => ({ ...action, disabled: true }))
						: actions
				}
			>
				<button
					ref={toggle}
					type="button"
					disabled={disabled || editing}
					aria-expanded={!collapsed}
					className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 pr-14 text-left text-[13px] font-medium focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
					onClick={onToggle}
					onDoubleClick={startRename}
				>
					<span className="relative grid size-4 shrink-0 place-items-center">
						<ProjectThumbnail
							projectName={project.name}
							iconUrl={resolveProjectIconUrl(project)}
							color={project.color}
							className="size-4 text-[10px] group-hover:opacity-0 group-focus-within:opacity-0"
						/>
						<HiChevronRight
							className={`absolute size-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${!collapsed ? "rotate-90" : ""}`}
						/>
					</span>
					<span className="truncate" title={project.name}>
						{project.name}
					</span>
				</button>
				{editing && (
					<Input
						data-inline-edit
						autoFocus
						disabled={saving}
						aria-label={t({ message: "Project name" })}
						aria-invalid={!!error}
						className="absolute left-7 right-14 h-6 w-auto text-xs"
						value={name}
						onFocus={(event) => event.target.select()}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						onBlur={() => {
							if (error) {
								setEditing(false);
								return;
							}
							if (!cancelled.current) void finishRename();
						}}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape" && !saving) {
								cancelled.current = true;
								setEditing(false);
								setError(null);
								requestAnimationFrame(() => toggle.current?.focus());
							}
							if (
								event.key === "Enter" &&
								!event.nativeEvent.isComposing &&
								event.nativeEvent.keyCode !== 229
							) {
								event.preventDefault();
								void finishRename(true);
							}
						}}
					/>
				)}
				<button
					type="button"
					disabled={disabled || editing}
					aria-label={t({ message: "New workspace" })}
					onClick={onNew}
					className="absolute right-7 grid size-5 place-items-center rounded opacity-0 hover:bg-foreground/10 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-50"
				>
					<HiMiniPlus className="size-3.5" />
				</button>
			</ProjectRowMenu>
			{error && (
				<p
					role="alert"
					className="mx-4 break-words py-1 text-xs text-destructive"
				>
					{error}
				</p>
			)}
		</div>
	);
}
