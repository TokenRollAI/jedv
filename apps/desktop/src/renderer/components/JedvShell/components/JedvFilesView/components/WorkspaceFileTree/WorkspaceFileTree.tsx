import { Button } from "@jedv/ui/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import type { FsWatchEvent } from "@jedv/workspace-fs/client";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
	ContextMenuAnchorRect,
	FileTreeDropResult,
	FileTreeRenameEvent,
} from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useQuery } from "@tanstack/react-query";
import {
	Copy,
	Eye,
	FilePlus,
	FolderPlus,
	FoldVertical,
	Loader2,
	MoveRight,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { useFallthroughIcons } from "renderer/lib/fileIcons";
import {
	createPierreTreeStyle,
	PIERRE_TREE_UNSAFE_CSS,
} from "renderer/lib/pierreTree";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useFilesTabActions } from "../../hooks/useFilesTabActions";
import { useFilesTabBridge } from "../../hooks/useFilesTabBridge";
import {
	type UploadConfirmation,
	useFilesTabDrop,
} from "../../hooks/useFilesTabDrop";
import { useGitStatusMap } from "../../hooks/useGitStatusMap";
import { buildPierreGitStatus } from "../../utils/buildPierreGitStatus";
import {
	ShadowClickHint,
	usePierreRowClickPolicy,
	useSidebarFilePolicy,
} from "../../utils/clickPolicy";
import { useFolderLinkAction } from "../../utils/link-policy";
import { stripTrailingSlash, toAbs } from "../../utils/treePath";
import { assertWorkspaceFileTarget } from "../../utils/workspace-file-client";
import {
	resolveWorkspaceFilePath,
	withinWorkspace,
} from "../../utils/workspace-path";
import { FileMenuItems } from "../FileMenuItems";
import {
	FileOperationDialog,
	type FileOperationTarget,
} from "../FileOperationDialog";
import { FilesTabDropOverlay } from "../FilesTabDropOverlay";
import { FileUploadConfirm } from "../FileUploadConfirm";
import { FolderMenuItems } from "../FolderMenuItems";
import { PierreRowContextMenu } from "../PierreRowContextMenu";
import { useFileTreeScrollFade } from "./hooks/useFileTreeScrollFade";

export function WorkspaceFileTree({
	client,
	workspaceId,
	rootPath,
	hostUrl,
	remote,
	active,
	gitEnabled = true,
	onSelectFile,
	refreshRevision,
	selectedPath,
	onFileEvent,
	onOpenExternal,
	revealTarget,
}: {
	client: LocalClient;
	workspaceId: string;
	rootPath: string;
	hostUrl: string;
	remote: boolean;
	active: boolean;
	gitEnabled?: boolean;
	onSelectFile(path: string, pinned: boolean): void;
	refreshRevision: number;
	selectedPath?: string;
	onFileEvent(event: FsWatchEvent): void;
	onOpenExternal(path: string): Promise<void>;
	revealTarget?: { path: string; revision: number } | null;
}) {
	const { t } = useLingui();
	const containerRef = useFileTreeScrollFade<HTMLFieldSetElement>(active);
	const sidebarFilePolicy = useSidebarFilePolicy(remote);
	const getFolderIntent = useFolderLinkAction({ remote });
	const alive = useRef(false);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const [uploadConfirmation, setUploadConfirmation] =
		useState<UploadConfirmation | null>(null);
	const [includeHidden, setIncludeHidden] = useState(true);
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const [target, setTarget] = useState<FileOperationTarget | null>(null);
	const [operationBusy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [rootMenu, setRootMenu] = useState<ContextMenuAnchorRect | null>(null);
	const handlers = useRef({
		rename: (_event: FileTreeRenameEvent) => {},
		move: (_event: FileTreeDropResult) => {},
		error: (_message: string) => {},
	});
	const { model } = useFileTree({
		paths: [],
		initialExpansion: "closed",
		search: false,
		unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
		icons: { set: "complete", colored: true },
		itemHeight: 28,
		overscan: 12,
		stickyFolders: true,
		renaming: {
			onRename: (event) => handlers.current.rename(event),
			onError: (message) => handlers.current.error(message),
		},
		dragAndDrop: {
			onDropComplete: (event) => handlers.current.move(event),
			onDropError: (message) => handlers.current.error(message),
		},
	});
	const bridge = useFilesTabBridge({
		model,
		client,
		workspaceId,
		rootPath,
		refreshRevision,
		includeHidden,
	});
	const drop = useFilesTabDrop({
		model,
		bridge,
		rootPath,
		workspaceId,
		client,
		requestConfirmation: setUploadConfirmation,
	});
	const actions = useFilesTabActions({
		model,
		bridge,
		client,
		workspaceId,
		rootPath,
		onFileMove: onFileEvent,
		onRequestDelete: (path, name, directory) => {
			setError(null);
			setTarget({ path, name, directory, mode: "delete" });
		},
	});
	const busy = operationBusy || actions.isPending;
	handlers.current = {
		rename: (event) => {
			void actions.handleRename(event);
		},
		move: (event) => {
			void actions.handleMove(event);
		},
		error: (message) => actions.handleRenameError(message),
	};
	useFallthroughIcons(model);
	const git = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-status"],
		queryFn: () =>
			client.git.getStatus.query({ workspaceId, priority: "background" }),
		enabled: active && gitEnabled,
		refetchInterval: active && gitEnabled ? 10000 : false,
		retry: false,
	});
	const maps = useGitStatusMap(gitEnabled ? git.data : undefined);
	useEffect(
		() =>
			model.setGitStatus(
				buildPierreGitStatus(
					maps.fileStatusByPath,
					maps.folderStatusByPath,
					maps.ignoredPaths,
				),
			),
		[model, maps],
	);
	const revealRef = useRef(actions.reveal);
	revealRef.current = actions.reveal;
	useEffect(() => {
		if (selectedPath) void revealRef.current(selectedPath, false);
	}, [selectedPath]);
	useEffect(() => {
		if (revealTarget && withinWorkspace(rootPath, revealTarget.path))
			void revealRef.current(revealTarget.path, false);
	}, [revealTarget, rootPath]);
	useEffect(() => {
		const timer = setTimeout(() => setSearch(query.trim()), 150);
		return () => clearTimeout(timer);
	}, [query]);
	const results = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"tree-search",
			search,
			includeHidden,
		],
		queryFn: () =>
			client.filesystem.searchFiles.query({
				workspaceId,
				query: search,
				includeHidden,
				limit: 100,
			}),
		enabled: !!search,
		retry: false,
	});
	const external = useCallback(
		async (path: string) => {
			if (remote || !withinWorkspace(rootPath, path)) return;
			try {
				await onOpenExternal(path);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[remote, rootPath, onOpenExternal],
	);

	const operate = async (destination: string) => {
		if (!target || busy) return;
		const source = resolveWorkspaceFilePath(rootPath, target.path);
		const dest = resolveWorkspaceFilePath(rootPath, destination);
		if (
			!source ||
			source === rootPath ||
			(target.mode !== "delete" && (!dest || dest === rootPath))
		) {
			setError(t({ message: "This file is outside the workspace" }));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			if (target.mode === "delete") {
				await client.filesystem.deletePath.mutate({
					workspaceId,
					absolutePath: source,
				});
				onFileEvent({
					kind: "delete",
					absolutePath: source,
					isDirectory: target.directory,
				});
			} else if (dest) {
				await (target.mode === "move"
					? client.filesystem.movePath
					: client.filesystem.copyPath
				).mutate({
					workspaceId,
					sourceAbsolutePath: source,
					destinationAbsolutePath: dest,
				});
				if (target.mode === "move")
					onFileEvent({
						kind: "rename",
						oldAbsolutePath: source,
						absolutePath: dest,
						isDirectory: target.directory,
					});
			}
			setTarget(null);
			await bridge.doRefresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			await bridge.doRefresh();
		} finally {
			setBusy(false);
		}
	};
	const { onClickCapture: openRow, findFileRow } = usePierreRowClickPolicy({
		filePolicy: sidebarFilePolicy,
		getFolderIntent,
		onRevealFolder: (relative) => {
			void actions.reveal(toAbs(rootPath, relative), false);
		},
		openInFinder: (relative) => {
			if (remote) return;
			const path = toAbs(rootPath, relative);
			void assertWorkspaceFileTarget(client, workspaceId, rootPath, path)
				.then(() => {
					if (alive.current)
						return electronTrpcClient.external.openFolderInFinder.mutate(path);
				})
				.catch((cause) => {
					if (alive.current)
						setError(cause instanceof Error ? cause.message : String(cause));
				});
		},
		onSelectFile: (relative, pinned) =>
			onSelectFile(toAbs(rootPath, relative), !!pinned),
		onRename: (path) => model.startRenaming(path),
		openInExternalEditor: (relative) =>
			void external(toAbs(rootPath, relative)),
	});

	return (
		<fieldset
			ref={containerRef}
			onDragOver={drop.onDragOver}
			onDragLeave={drop.onDragLeave}
			onDrop={drop.onDrop}
			onDragStart={(event) => {
				for (const node of event.nativeEvent.composedPath()) {
					if (!(node instanceof HTMLElement)) continue;
					const path = node.dataset.itemPath;
					if (!path) continue;
					const absolute = toAbs(rootPath, path);
					event.dataTransfer.setData("text/plain", absolute);
					event.dataTransfer.setData("application/x-jedv-file-path", absolute);
					event.dataTransfer.effectAllowed = "copyMove";
					break;
				}
			}}
			aria-label={t({ message: "Files" })}
			className="relative flex h-full min-h-0 flex-col border-r bg-background"
			onClickCapture={(event) => {
				const interactive = event.nativeEvent
					.composedPath()
					.some(
						(node) =>
							node instanceof HTMLElement &&
							(node.dataset.itemPath !== undefined ||
								node.matches("button,input,[role=menu]")),
					);
				if (!interactive)
					for (const path of model.getSelectedPaths())
						model.getItem(path)?.deselect();
				openRow(event);
			}}
			onKeyDown={(event) => {
				if (
					event.key === "Enter" &&
					!event.nativeEvent
						.composedPath()
						.some((node) => node instanceof HTMLInputElement)
				) {
					const path = model.getSelectedPaths()[0];
					if (path && !path.endsWith("/"))
						onSelectFile(toAbs(rootPath, path), true);
				}
			}}
			onContextMenu={(event) => {
				if (
					event.nativeEvent
						.composedPath()
						.some(
							(node) =>
								node instanceof HTMLElement &&
								node.dataset.itemPath !== undefined,
						)
				)
					return;
				if ((event.target as HTMLElement).closest("button,input")) return;
				event.preventDefault();
				const { x, y } = { x: event.clientX, y: event.clientY };
				setRootMenu({
					x,
					y,
					left: x,
					right: x,
					top: y,
					bottom: y,
					width: 0,
					height: 0,
				});
			}}
		>
			<div className="flex h-9 shrink-0 items-center gap-0.5 px-2 text-xs text-muted-foreground">
				<span
					className="mr-auto truncate pl-1 font-mono text-[11.5px] font-medium text-muted-foreground"
					title={rootPath}
				>
					{rootPath.split(/[\\/]/).filter(Boolean).pop() ||
						t({ message: "Files" })}
				</span>
				{[
					{
						icon: FilePlus,
						label: t({ message: "New File" }),
						action: () => void actions.startCreating("file"),
					},
					{
						icon: FolderPlus,
						label: t({ message: "New Folder" }),
						action: () => void actions.startCreating("folder"),
					},
					{
						icon: RefreshCw,
						label: t({ message: "Refresh" }),
						action: () => void bridge.doRefresh(),
					},
					{
						icon: FoldVertical,
						label: t({ message: "Collapse All" }),
						action: actions.collapseAll,
					},
					{
						icon: Eye,
						label: t({ message: "Show hidden files" }),
						action: () => setIncludeHidden((value) => !value),
					},
				].map(({ icon: Icon, label, action }) => (
					<Button
						key={label}
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						aria-label={label}
						title={label}
						disabled={busy}
						aria-pressed={
							label === t({ message: "Show hidden files" })
								? includeHidden
								: undefined
						}
						onClick={action}
					>
						<Icon className="size-3.5" aria-hidden="true" />
					</Button>
				))}
			</div>
			<div className="relative mx-2 mb-2">
				<Search
					aria-hidden="true"
					className="absolute left-2 top-2 size-3.5 text-muted-foreground"
				/>
				<Input
					aria-label={t({ message: "Search files" })}
					placeholder={t({ message: "Search files" })}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="h-7 pl-7 pr-6 text-xs"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							setQuery("");
						}
					}}
				/>
				{query && (
					<button
						type="button"
						aria-label={t({ message: "Clear search" })}
						onClick={() => setQuery("")}
						className="absolute right-1 top-1 size-5"
					>
						<X className="size-3" aria-hidden="true" />
					</button>
				)}
			</div>
			{(bridge.error || (!target && error) || git.error) && (
				<div role="alert" className="px-3 pb-2 text-xs text-destructive">
					{bridge.error || error || git.error?.message}
				</div>
			)}
			{search ? (
				<div className="min-h-0 flex-1 overflow-auto">
					{results.isFetching ? (
						<output className="block px-3 text-xs">
							<Trans>Loading files…</Trans>
						</output>
					) : results.error ? (
						<p role="alert" className="px-3 text-xs text-destructive">
							{results.error.message}
						</p>
					) : results.data?.matches.length === 0 ? (
						<p className="px-3 text-xs text-muted-foreground">
							<Trans>No files found</Trans>
						</p>
					) : (
						results.data?.matches
							.filter((match) => withinWorkspace(rootPath, match.absolutePath))
							.map((match) => (
								<button
									key={match.absolutePath}
									type="button"
									title={match.relativePath}
									className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-fill-hover focus-visible:bg-fill-selected"
									onClick={(event) => {
										if (match.kind === "directory") {
											setQuery("");
											void actions.reveal(match.absolutePath, true);
										} else {
											const action = sidebarFilePolicy.getAction(event);
											if (action === "external")
												void external(match.absolutePath);
											else if (action)
												onSelectFile(match.absolutePath, action === "newTab");
										}
									}}
								>
									{match.relativePath}
								</button>
							))
					)}
					{results.data && results.data.matches.length >= 100 && (
						<p className="p-3 text-xs text-muted-foreground">
							<Trans>Showing the first 100 results. Refine your search.</Trans>
						</p>
					)}
				</div>
			) : (
				<>
					{bridge.loading && (
						<output className="flex items-center gap-1 px-3 text-xs text-muted-foreground">
							<Loader2 className="size-3 animate-spin" aria-hidden="true" />
							<Trans>Loading files…</Trans>
						</output>
					)}
					{!bridge.loading && bridge.knownPaths.size === 0 && !bridge.error && (
						<p className="px-3 text-xs text-muted-foreground">
							<Trans>No files found</Trans>
						</p>
					)}
					<ShadowClickHint hint={sidebarFilePolicy.hint} findRow={findFileRow}>
						<FileTree
							model={model}
							className="min-h-0 flex-1"
							style={createPierreTreeStyle({
								levelIndent: 14,
								withSearchChrome: false,
							})}
							renderContextMenu={(item, ctx) => {
								const folder = item.kind === "directory",
									path = stripTrailingSlash(item.path),
									absolutePath = toAbs(rootPath, path);
								const more = (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											disabled={busy}
											onSelect={() => {
												setError(null);
												setTarget({
													path: absolutePath,
													name: item.name,
													directory: folder,
													mode: "move",
												});
											}}
										>
											<MoveRight />
											<Trans>Move...</Trans>
										</DropdownMenuItem>
										<DropdownMenuItem
											disabled={busy}
											onSelect={() => {
												setError(null);
												setTarget({
													path: absolutePath,
													name: item.name,
													directory: folder,
													mode: "copy",
												});
											}}
										>
											<Copy />
											<Trans>Copy...</Trans>
										</DropdownMenuItem>
									</>
								);
								return (
									<PierreRowContextMenu
										anchorRect={ctx.anchorRect}
										onClose={ctx.close}
										data-file-tree-context-menu-root="true"
									>
										{folder ? (
											<FolderMenuItems
												absolutePath={absolutePath}
												relativePath={path}
												remote={remote}
												busy={busy}
												onNewFile={() =>
													void actions.startCreating("file", absolutePath)
												}
												onNewFolder={() =>
													void actions.startCreating("folder", absolutePath)
												}
												onRename={() => model.startRenaming(`${path}/`)}
												onDelete={() =>
													actions.handleDelete(absolutePath, item.name, true)
												}
											/>
										) : (
											<FileMenuItems
												absolutePath={absolutePath}
												relativePath={path}
												remote={remote}
												busy={busy}
												onOpen={() => onSelectFile(absolutePath, false)}
												onOpenInNewTab={() => onSelectFile(absolutePath, true)}
												onOpenInEditor={() => void external(absolutePath)}
												onRename={() => model.startRenaming(path)}
												onDelete={() =>
													actions.handleDelete(absolutePath, item.name, false)
												}
											/>
										)}{" "}
										{more}
									</PierreRowContextMenu>
								);
							}}
						/>
					</ShadowClickHint>
				</>
			)}
			{drop.dropTarget && <FilesTabDropOverlay target={drop.dropTarget} />}
			{uploadConfirmation && (
				<FileUploadConfirm
					options={uploadConfirmation}
					onClose={() => setUploadConfirmation(null)}
				/>
			)}
			{rootMenu && (
				<PierreRowContextMenu
					anchorRect={rootMenu}
					onClose={() => setRootMenu(null)}
					data-file-tree-context-menu-root="true"
				>
					<DropdownMenuItem
						disabled={busy}
						onSelect={() =>
							setTimeout(() => void actions.startCreating("file", rootPath), 0)
						}
					>
						<FilePlus />
						<Trans>New File...</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={busy}
						onSelect={() =>
							setTimeout(
								() => void actions.startCreating("folder", rootPath),
								0,
							)
						}
					>
						<FolderPlus />
						<Trans>New Folder...</Trans>
					</DropdownMenuItem>
				</PierreRowContextMenu>
			)}
			{target && (
				<FileOperationDialog
					key={`${target.mode}:${target.path}`}
					target={target}
					busy={busy}
					error={error}
					onCancel={() => {
						setTarget(null);
						setError(null);
					}}
					onConfirm={(destination) => void operate(destination)}
				/>
			)}
		</fieldset>
	);
}
