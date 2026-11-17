import { Button } from "@jedv/ui/button";
import { Kbd } from "@jedv/ui/kbd";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@jedv/ui/resizable";
import { getEventBus } from "@jedv/workspace-client";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileCode2, Save } from "lucide-react";
import {
	type ComponentRef,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useFileOpenMode } from "renderer/hooks/useFileOpenMode";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { isMarkdownFile } from "shared/file-types";
import { supportsGit } from "../../../../vcs-capabilities";
import type { JedvFilesViewProps } from "../../props";
import { FileAutoSaveController } from "../../state/fileDocumentStore/fileAutoSave";
import { createFileDocumentStore } from "../../state/fileDocumentStore/fileDocumentStore";
import type { SharedFileDocument } from "../../state/fileDocumentStore/types";
import {
	useFileLinkAction,
	useFolderLinkAction,
} from "../../utils/link-policy";
import { markdownFileTarget } from "../../utils/link-policy/markdown-target";
import {
	assertWorkspaceFileTarget,
	createWorkspaceFileClient,
} from "../../utils/workspace-file-client";
import {
	resolveWorkspaceFilePath,
	withinWorkspace,
} from "../../utils/workspace-path";
import { FileDocumentPane } from "../FileDocumentPane/FileDocumentPane";
import { FileDocumentTabs } from "../FileDocumentTabs";
import { UnsavedFileDialog } from "../UnsavedFileDialog/UnsavedFileDialog";
import { WorkspaceFileTree } from "../WorkspaceFileTree/WorkspaceFileTree";

export function FilesWorkspace({
	context,
	workspaceId,
	initialPath,
	initialPinned = false,
	initialRequestId,
	getWsToken,
	active = true,
	onDirtyChange,
	onOpenUrl,
}: JedvFilesViewProps) {
	const { t } = useLingui();
	const quickOpenShortcut = useHotkeyDisplay("QUICK_OPEN").text;
	const { client: rawClient, hostUrl, remote } = context;
	const workspace = useQuery({
		queryKey: ["jedv", hostUrl, "files-workspace", workspaceId],
		queryFn: () => rawClient.workspace.get.query({ id: workspaceId }),
	});
	const rootPath = workspace.data?.worktreePath ?? "";
	const fileAction = useFileLinkAction("4-tier", { remote: remote !== null });
	const folderAction = useFolderLinkAction({ remote: remote !== null });
	const [revealTarget, setRevealTarget] = useState<{
		path: string;
		revision: number;
	} | null>(null);
	const alive = useRef(false);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const client = useMemo(
		() =>
			rootPath
				? createWorkspaceFileClient(rawClient, workspaceId, rootPath)
				: rawClient,
		[rawClient, workspaceId, rootPath],
	);
	const [store] = useState(createFileDocumentStore);
	const version = useSyncExternalStore(
		store.subscribeDocuments,
		store.getVersion,
	);
	const documents = store.getDocuments();
	const [activeId, setActiveId] = useState<string | null>(null);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [markdownPreview, setMarkdownPreview] = useState(false);
	const [closeQueue, setCloseQueue] = useState<string[]>([]);
	const [watchStale, setWatchStale] = useState(false);
	const closing = closeQueue[0] ?? null;
	const setClosing = (id: string | null) => setCloseQueue(id ? [id] : []);
	const [error, setError] = useState<string | null>(null);
	const [treeRevision, setTreeRevision] = useState(0);
	const [panelGroupWidth, setPanelGroupWidth] = useState(0);
	const panelGroupRef = useRef<HTMLDivElement>(null);
	const treePanelRef = useRef<ComponentRef<typeof ResizablePanel>>(null);
	useEffect(() => {
		const node = panelGroupRef.current;
		if (!node) return;
		const update = () => {
			if (node.clientWidth > 0) setPanelGroupWidth(node.clientWidth);
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	const treeMinSize =
		panelGroupWidth > 0
			? Math.min(45, Math.max(18, (180 / panelGroupWidth) * 100))
			: 24;
	useEffect(() => {
		const panel = treePanelRef.current;
		if (!panel || panelGroupWidth <= 0) return;
		if (panel.getSize() < treeMinSize) {
			panel.resize(treeMinSize);
		}
	}, [panelGroupWidth, treeMinSize]);
	const fileOpenMode = useFileOpenMode();
	const autoSave = electronTrpc.settings.getFileAutoSave.useQuery();
	const externalEditor = electronTrpc.external.openFileInEditor.useMutation();
	const [controller] = useState(() => new FileAutoSaveController(store));
	const tokenRef = useRef(getWsToken);
	tokenRef.current = getWsToken;
	const bus = useMemo(
		() => getEventBus(hostUrl, () => tokenRef.current()),
		[hostUrl],
	);
	const dirty = documents.some(
		(document) => document.dirty || document.pendingSave,
	);
	const dirtyCallback = useRef(onDirtyChange);
	dirtyCallback.current = onDirtyChange;
	useEffect(() => {
		dirtyCallback.current?.(dirty);
	}, [dirty]);
	useEffect(() => () => dirtyCallback.current?.(false), []);
	useEffect(() => controller.start(), [controller]);
	useEffect(
		() => controller.setMode(autoSave.data ?? "off"),
		[controller, autoSave.data],
	);
	useEffect(() => {
		if (!active)
			for (const document of store.getDocuments())
				controller.onFocusChange(document);
	}, [active, controller, store]);
	useEffect(() => {
		const onBlur = () => controller.onWindowChange();
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (
				store
					.getDocuments()
					.some((document) => document.dirty || document.pendingSave)
			) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("blur", onBlur);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [controller, store]);
	useEffect(() => {
		if (!rootPath) return;
		const release = bus.retain();
		const unsubscribe = bus.on(
			"fs:events",
			workspaceId,
			(_workspaceId, payload) => {
				if (payload.events.some((event) => event.kind === "overflow"))
					setWatchStale(true);
				for (const originalEvent of payload.events) {
					const event =
						originalEvent.kind === "rename" &&
						!withinWorkspace(rootPath, originalEvent.absolutePath) &&
						originalEvent.oldAbsolutePath &&
						withinWorkspace(rootPath, originalEvent.oldAbsolutePath)
							? {
									kind: "delete" as const,
									absolutePath: originalEvent.oldAbsolutePath,
									isDirectory: originalEvent.isDirectory,
								}
							: originalEvent;
					if (
						event.kind !== "overflow" &&
						!withinWorkspace(rootPath, event.absolutePath)
					)
						continue;
					store.dispatchFsEvent(workspaceId, event);
					if (event.kind !== "update") setTreeRevision((value) => value + 1);
				}
			},
		);
		bus.watchFs(workspaceId);
		const unsubscribeStatus = bus.subscribeConnectionStatus((status) => {
			if (status.state !== "open") setWatchStale(true);
		});
		return () => {
			unsubscribeStatus();
			bus.unwatchFs(workspaceId);
			unsubscribe();
			release();
		};
	}, [bus, store, workspaceId, rootPath]);
	const watchedPaths = JSON.stringify(
		documents.map((document) => document.absolutePath).sort(),
	);
	useEffect(() => {
		const paths: string[] = JSON.parse(watchedPaths);
		for (const path of paths) bus.watchFsFile(workspaceId, path);
		return () => {
			for (const path of paths) bus.unwatchFsFile(workspaceId, path);
		};
	}, [bus, workspaceId, watchedPaths]);
	const selected =
		documents.find((document) => document.id === activeId) ?? documents[0];
	const rightPreview = documents.find((document) => document.id === previewId);
	const primary =
		selected?.id === previewId
			? documents.find((document) => document.id !== previewId)
			: selected;
	const remove = useCallback(
		(document: SharedFileDocument, discard = false) => {
			store.releaseDocument(workspaceId, document.absolutePath, { discard });
			setActiveId((current) => (current === document.id ? null : current));
			setPreviewId((current) => (current === document.id ? null : current));
			setCloseQueue((queue) => queue.filter((id) => id !== document.id));
		},
		[store, workspaceId],
	);
	const open = (path: string, pinned: boolean) => {
		const absolutePath = resolveWorkspaceFilePath(rootPath, path);
		if (!absolutePath) {
			setError(t({ message: "This file is outside the workspace" }));
			return;
		}
		setError(null);
		const existing = store.getDocument(workspaceId, absolutePath);
		if (existing) {
			setActiveId(existing.id);
			if (pinned) setPreviewId(null);
			return;
		}
		const oldPreview = rightPreview;
		if (
			fileOpenMode === "split-pane" &&
			oldPreview &&
			!oldPreview.dirty &&
			!oldPreview.pendingSave
		)
			remove(oldPreview);
		try {
			const document = store.acquireDocument(workspaceId, absolutePath, client);
			setActiveId(document.id);
			setPreviewId(
				fileOpenMode === "split-pane" && !pinned ? document.id : null,
			);
			setMarkdownPreview(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const openRef = useRef(open);
	openRef.current = open;
	useEffect(() => {
		void initialRequestId;
		if (!initialPath || !rootPath) return;
		let cancelled = false;
		void rawClient.filesystem.statPath
			.mutate({ workspaceId, path: initialPath })
			.then((stat) => {
				if (cancelled) return;
				if (!stat) {
					setError(t({ message: "File not found" }));
					return;
				}
				if (!withinWorkspace(rootPath, stat.resolvedPath)) {
					setError(t({ message: "This file is outside the workspace" }));
					return;
				}
				if (stat.isDirectory)
					setRevealTarget((previous) => ({
						path: stat.resolvedPath,
						revision: (previous?.revision ?? 0) + 1,
					}));
				else openRef.current(stat.resolvedPath, initialPinned);
			})
			.catch((cause) => {
				if (!cancelled)
					setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [
		initialPath,
		initialPinned,
		initialRequestId,
		t,
		rootPath,
		rawClient,
		workspaceId,
	]);
	useEffect(() => {
		void version;
		const document = store
			.getDocuments()
			.find((item) => item.id === closeQueue[0]);
		if (!document && closeQueue.length)
			setCloseQueue((queue) => queue.slice(1));
		else if (document && !document.dirty && !document.pendingSave)
			remove(document);
	}, [closeQueue, version, remove, store]);
	const saveAll = async () => {
		const targets = store
			.getDocuments()
			.filter(
				(document) =>
					document.dirty && !document.pendingSave && !document.orphaned,
			);
		const results = await Promise.all(
			targets.map((document) => document.save()),
		);
		if (results.some((result) => result.status !== "saved"))
			setError(
				t({
					message:
						"Some files could not be saved. Review their tabs before closing.",
				}),
			);
	};
	if (workspace.error || (!workspace.isPending && !rootPath))
		return (
			<div role="alert" className="p-6 text-sm text-destructive">
				{workspace.error?.message ??
					t({ message: "Workspace files are unavailable" })}
			</div>
		);
	if (!rootPath)
		return (
			<div className="p-6 text-sm text-muted-foreground">
				<Trans>Loading files…</Trans>
			</div>
		);
	const openExternal = async (path: string) => {
		if (remote || !rootPath) return;
		await assertWorkspaceFileTarget(rawClient, workspaceId, rootPath, path);
		if (!alive.current) return;
		await externalEditor.mutateAsync({
			path,
			worktreePath: rootPath,
			projectId: workspace.data?.projectId ?? undefined,
		});
	};
	const onFileLinkClick = (
		event: React.MouseEvent,
		document: SharedFileDocument,
	) => {
		if (
			event.button !== 0 ||
			event.altKey ||
			!markdownPreview ||
			!isMarkdownFile(document.absolutePath)
		)
			return;
		const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
		const href = anchor?.getAttribute("href");
		if (!href || /^(?:https?:|mailto:|#)/i.test(href)) return;
		event.preventDefault();
		event.stopPropagation();
		const path = markdownFileTarget(rootPath, document.absolutePath, href);
		if (!path) {
			setError(t({ message: "This file is outside the workspace" }));
			return;
		}
		const action = fileAction(event);
		const folder = folderAction(event);
		void (async () => {
			try {
				const stat = await client.filesystem.statPath.mutate({
					workspaceId,
					path,
				});
				if (
					!alive.current ||
					!store.getDocument(workspaceId, document.absolutePath)
				)
					return;
				if (!stat || !withinWorkspace(rootPath, stat.resolvedPath)) {
					setError(t({ message: "File not found" }));
					return;
				}
				if (stat.isDirectory) {
					if (folder === "reveal")
						setRevealTarget((previous) => ({
							path: stat.resolvedPath,
							revision: (previous?.revision ?? 0) + 1,
						}));
					else if (folder === "external") await openExternal(stat.resolvedPath);
					else if (folder === "finder" && !remote) {
						await assertWorkspaceFileTarget(
							rawClient,
							workspaceId,
							rootPath,
							stat.resolvedPath,
						);
						if (alive.current)
							await electronTrpcClient.external.openFolderInFinder.mutate(
								stat.resolvedPath,
							);
					}
				} else if (action === "external") await openExternal(stat.resolvedPath);
				else if (action)
					openRef.current(stat.resolvedPath, action === "newTab");
			} catch (cause) {
				if (alive.current)
					setError(cause instanceof Error ? cause.message : String(cause));
			}
		})();
	};
	const failedSaves = documents.filter((document) => document.saveError);
	const closingDocument = documents.find((document) => document.id === closing);
	const renderDocument = (document: SharedFileDocument) => (
		<div
			className="h-full min-h-0"
			onPointerDownCapture={() => setActiveId(document.id)}
			onClickCapture={(event) => onFileLinkClick(event, document)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node))
					controller.onFocusChange(document);
			}}
		>
			<FileDocumentPane
				document={document}
				preview={markdownPreview && isMarkdownFile(document.absolutePath)}
				active={active && document.id === selected?.id}
				rootPath={rootPath}
				client={client}
				decodeBase64={store.decodeBase64}
				onOpenUrl={
					onOpenUrl
						? (url, action) => {
								void Promise.resolve()
									.then(() =>
										onOpenUrl(
											url,
											action === "newTab" ? "new-tab" : "split-pane",
										),
									)
									.catch((cause) =>
										setError(
											cause instanceof Error ? cause.message : String(cause),
										),
									);
							}
						: undefined
				}
			/>
		</div>
	);
	void version;
	return (
		<div
			className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-background"
			data-jedv-files-view
		>
			<UnsavedFileDialog
				path={closingDocument?.absolutePath ?? null}
				busy={closingDocument?.pendingSave ?? false}
				onCancel={() => setClosing(null)}
				onSave={() => {
					if (closingDocument)
						void closingDocument.save().then((result) => {
							if (result.status === "saved" && !closingDocument.dirty)
								remove(closingDocument);
							else {
								setCloseQueue([]);
								setActiveId(closingDocument.id);
							}
						});
				}}
				onDiscard={() => {
					if (closingDocument) remove(closingDocument, true);
				}}
			/>
			<div ref={panelGroupRef} className="min-h-0 flex-1">
				<ResizablePanelGroup direction="horizontal">
					<ResizablePanel
						ref={treePanelRef}
						defaultSize={24}
						minSize={treeMinSize}
						maxSize={45}
						style={{
							minWidth:
								panelGroupWidth > 0
									? `${Math.min(180, Math.round(panelGroupWidth * 0.45))}px`
									: "180px",
						}}
					>
						<WorkspaceFileTree
							gitEnabled={supportsGit(workspace.data)}
							client={client}
							hostUrl={hostUrl}
							remote={remote !== null}
							active={active}
							selectedPath={selected?.absolutePath}
							revealTarget={revealTarget}
							onOpenExternal={openExternal}
							onFileEvent={(event) => {
								store.dispatchFsEvent(workspaceId, event);
								setTreeRevision((value) => value + 1);
							}}
							workspaceId={workspaceId}
							rootPath={rootPath}
							onSelectFile={open}
							refreshRevision={treeRevision}
						/>
					</ResizablePanel>
					<ResizableHandle className="bg-border transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60" />
					<ResizablePanel defaultSize={76} minSize={30}>
						<div className="flex h-full min-h-0 flex-col">
							<FileDocumentTabs
								documents={documents}
								selectedId={selected?.id}
								previewId={previewId}
								onSelect={(id) => {
									setActiveId(id);
									setPreviewId(null);
								}}
								onClose={(ids) => setCloseQueue(ids)}
								onSaveAll={() => void saveAll()}
								onError={setError}
							/>
							{watchStale && (
								<div
									role="alert"
									className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
								>
									<span className="min-w-0 flex-1">
										<Trans>
											File updates may be out of date. Reload open files to
											check the disk.
										</Trans>
									</span>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 text-xs"
										onClick={() => {
											for (const document of store.getDocuments())
												store.dispatchFsEvent(workspaceId, {
													kind: "overflow",
													absolutePath: document.absolutePath,
												});
											setTreeRevision((value) => value + 1);
											setWatchStale(bus.getConnectionStatus().state !== "open");
										}}
									>
										<Trans>Refresh</Trans>
									</Button>
								</div>
							)}

							{selected && (
								<div className="flex h-9 min-w-0 shrink-0 items-center gap-2 border-b px-3 text-xs">
									<span
										className="min-w-0 flex-1 truncate text-muted-foreground"
										title={selected.absolutePath}
									>
										{selected.absolutePath.slice(rootPath.length + 1)}
									</span>
									<span className="shrink-0 whitespace-nowrap text-muted-foreground">
										{selected.pendingSave ? (
											<Trans>Saving…</Trans>
										) : selected.dirty ? (
											<Trans>Unsaved changes</Trans>
										) : (
											<Trans>Saved</Trans>
										)}
									</span>

									{isMarkdownFile(selected.absolutePath) && (
										<>
											<Button
												variant={!markdownPreview ? "secondary" : "ghost"}
												size="sm"
												className="h-6 shrink-0 text-xs"
												onClick={() => setMarkdownPreview(false)}
											>
												<Trans>Edit</Trans>
											</Button>
											<Button
												variant={markdownPreview ? "secondary" : "ghost"}
												size="sm"
												className="h-6 shrink-0 text-xs"
												onClick={() => setMarkdownPreview(true)}
											>
												<Trans>Preview</Trans>
											</Button>
										</>
									)}
									<Button
										variant="ghost"
										size="icon"
										className="size-6 shrink-0"
										aria-label={t({ message: "Save file" })}
										disabled={
											!selected.dirty ||
											selected.pendingSave ||
											selected.orphaned
										}
										onClick={() => void selected.save()}
									>
										<Save className="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="size-6 shrink-0"
										aria-label={t({ message: "Open in external editor" })}
										disabled={remote !== null || externalEditor.isPending}
										title={
											remote
												? t({
														message:
															"External editors open files on this machine only",
													})
												: undefined
										}
										onClick={() => {
											void openExternal(selected.absolutePath).catch((cause) =>
												setError(
													cause instanceof Error
														? cause.message
														: String(cause),
												),
											);
										}}
									>
										<ExternalLink className="size-3.5" />
									</Button>
								</div>
							)}
							{failedSaves.length > 0 && (
								<div
									role="alert"
									className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-destructive"
								>
									<span className="min-w-0 flex-1">
										<Trans>
											{failedSaves.length} files could not be saved.
										</Trans>
									</span>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 text-xs"
										onClick={() => setActiveId(failedSaves[0].id)}
									>
										<Trans>Review</Trans>
									</Button>
								</div>
							)}
							{error && (
								<div
									role="alert"
									className="px-3 py-2 text-xs text-destructive"
								>
									{error}
								</div>
							)}
							<div className="flex min-h-0 flex-1 flex-col">
								{rightPreview && primary ? (
									<ResizablePanelGroup direction="horizontal">
										<ResizablePanel minSize={20}>
											{renderDocument(primary)}
										</ResizablePanel>
										<ResizableHandle />
										<ResizablePanel minSize={20}>
											{renderDocument(rightPreview)}
										</ResizablePanel>
									</ResizablePanelGroup>
								) : selected ? (
									renderDocument(selected)
								) : (
									<div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center">
										<FileCode2 className="size-8 text-muted-foreground/45" />
										<p className="text-[13px] text-muted-foreground">
											<Trans>Select a file to preview or edit</Trans>
										</p>
										{quickOpenShortcut !== "Unassigned" && (
											<div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/75">
												<Trans>Search Files</Trans>
												<Kbd>{quickOpenShortcut}</Kbd>
											</div>
										)}
									</div>
								)}
							</div>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
