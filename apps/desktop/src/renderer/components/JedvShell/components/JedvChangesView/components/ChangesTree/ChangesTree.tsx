import { Button } from "@jedv/ui/button";
import { useLingui } from "@lingui/react/macro";
import { FileTree, useFileTreeSelector } from "@pierre/trees/react";
import { Minus, Plus, Undo2 } from "lucide-react";
import { useRef } from "react";
import { createPierreTreeStyle } from "renderer/lib/pierreTree";
import { PierreRowContextMenu } from "../../../JedvFilesView/components/PierreRowContextMenu";
import {
	buildChangesSidebarFileHint,
	resolveChangesSidebarFileIntent,
	ShadowClickHint,
	sidebarFilePolicy,
	usePierreChangesSidebarRowClickPolicy,
} from "../../../JedvFilesView/utils/clickPolicy";
import { useChangedFilesTree } from "../../hooks/useChangedFilesTree";
import type { FoldSignal } from "../../hooks/useFoldSignal";
import type { Category, ChangedFile } from "../../types";
import { ChangesFileMenu } from "../ChangesFileMenu";
import {
	HOVER_ACTIONS_ROW_CSS,
	ShadowRowHoverActions,
} from "./components/ShadowRowHoverActions";
export function ChangesTree({
	files,
	category,
	foldSignal,
	selectedPath,
	onSelect,
	onOpen,
	onStage,
	onDiscard,
	onCopy,
	onExternal,
	remote,
	rootPath,
	isPending,
	active = true,
}: {
	files: ChangedFile[];
	category: Category;
	foldSignal: FoldSignal;
	selectedPath?: string;
	onSelect(file: ChangedFile, newTab?: boolean): void;
	onOpen(file: ChangedFile, pinned?: boolean): void;
	onStage(file: ChangedFile): void;
	onDiscard(file: ChangedFile): void;
	onCopy(path: string): void;
	onExternal(path: string): void;
	remote: boolean;
	rootPath?: string;
	isPending(file: ChangedFile): boolean;
	active?: boolean;
}) {
	const { t } = useLingui();
	const dragRow = useRef<HTMLElement | null>(null);
	const { model, fileByTreePath, toRealPath } = useChangedFilesTree({
		files,
		unsafeCSS: HOVER_ACTIONS_ROW_CSS,
		foldSignal,
		onSelectFile: onSelect,
		selectedPath,
	});
	const height =
		useFileTreeSelector(model, (tree) => tree.getVisibleCount()) *
			model.getItemHeight() +
		8;
	const { onClickCapture, findFileRow } = usePierreChangesSidebarRowClickPolicy(
		{
			getFileIntent: (event) =>
				resolveChangesSidebarFileIntent(sidebarFilePolicy.map, event),
			onSelectDiff: (path, newTab) => {
				const file = files.find(
					(file) => file.path === (toRealPath.get(path) ?? path),
				);
				if (file) onSelect(file, newTab);
			},
			onOpenFile: (path) => {
				const file = files.find(
					(file) => file.path === (toRealPath.get(path) ?? path),
				);
				if (file && file.status !== "deleted") onOpen(file);
			},
			openInExternalEditor: (path) => onExternal(toRealPath.get(path) ?? path),
		},
	);
	const menu = (file: ChangedFile) => (
		<ChangesFileMenu
			remote={remote}
			rootPath={rootPath}
			onExternal={() => onExternal(file.path)}
			file={file}
			category={category}
			busy={isPending(file)}
			onDiff={(newTab) => onSelect(file, newTab)}
			onOpen={(pinned) => onOpen(file, pinned)}
			onStage={() => onStage(file)}
			onDiscard={() => onDiscard(file)}
			onCopy={() => onCopy(file.path)}
		/>
	);
	return (
		<fieldset
			className="contents"
			draggable
			onClickCapture={onClickCapture}
			onPointerDownCapture={(event) => {
				for (const node of event.nativeEvent.composedPath()) {
					if (
						node instanceof HTMLElement &&
						node.dataset.itemPath &&
						!node.dataset.itemPath.endsWith("/")
					) {
						dragRow.current = node;
						return;
					}
				}
				dragRow.current = null;
			}}
			onDragStart={(event) => {
				const path = dragRow.current?.dataset.itemPath;
				if (!path || !rootPath) {
					event.preventDefault();
					return;
				}
				const absolute = `${rootPath.replace(/\/$/, "")}/${toRealPath.get(path) ?? path}`;
				event.dataTransfer.setData("text/plain", absolute);
				event.dataTransfer.setData("application/x-jedv-file-path", absolute);
				event.dataTransfer.effectAllowed = "copy";
			}}
		>
			<ShadowClickHint
				hint={buildChangesSidebarFileHint(sidebarFilePolicy.map)}
				findRow={findFileRow}
			>
				<ShadowRowHoverActions
					active={active}
					findFileRow={findFileRow}
					renderMenuContent={(path) => {
						const file = fileByTreePath.get(path);
						return file ? menu(file) : null;
					}}
					renderInlineActions={(path) => {
						const file = fileByTreePath.get(path);
						if (!file || category === "against-base" || category === "commit")
							return null;
						return (
							<>
								{category === "unstaged" && (
									<Button
										size="icon"
										variant="ghost"
										className="size-5"
										disabled={
											isPending(file) ||
											file.status === "renamed" ||
											file.status === "copied"
										}
										title={t({ message: "Discard Changes" })}
										aria-label={t({ message: "Discard Changes" })}
										onClick={() => onDiscard(file)}
									>
										<Undo2 className="size-3.5" />
									</Button>
								)}
								<Button
									size="icon"
									variant="ghost"
									className="size-5"
									disabled={isPending(file)}
									title={
										category === "staged"
											? t({ message: "Unstage file" })
											: t({ message: "Stage file" })
									}
									aria-label={
										category === "staged"
											? t({ message: "Unstage file" })
											: t({ message: "Stage file" })
									}
									onClick={() => onStage(file)}
								>
									{category === "staged" ? (
										<Minus className="size-3.5" />
									) : (
										<Plus className="size-3.5" />
									)}
								</Button>
							</>
						);
					}}
				>
					<FileTree
						model={model}
						style={{ ...createPierreTreeStyle({ levelIndent: 8 }), height }}
						renderContextMenu={(item, ctx) => {
							const file = fileByTreePath.get(item.path);
							if (!file) return null;
							return (
								<PierreRowContextMenu
									anchorRect={ctx.anchorRect}
									onClose={ctx.close}
									data-file-tree-context-menu-root="true"
								>
									<ChangesFileMenu
										remote={remote}
										rootPath={rootPath}
										onExternal={() => onExternal(file.path)}
										file={file}
										category={category}
										busy={isPending(file)}
										onDiff={(newTab) => onSelect(file, newTab)}
										onOpen={(pinned) => onOpen(file, pinned)}
										onStage={() => onStage(file)}
										onDiscard={() => onDiscard(file)}
										onCopy={() => onCopy(file.path)}
									/>
								</PierreRowContextMenu>
							);
						}}
					/>
				</ShadowRowHoverActions>
			</ShadowClickHint>
		</fieldset>
	);
}
