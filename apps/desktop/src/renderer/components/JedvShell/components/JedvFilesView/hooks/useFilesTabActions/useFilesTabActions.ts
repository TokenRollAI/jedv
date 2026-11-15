import { toast } from "@jedv/ui/sonner";
import type { FsWatchEvent } from "@jedv/workspace-fs/client";
import { useLingui } from "@lingui/react/macro";
import type {
	FileTree,
	FileTreeDropResult,
	FileTreeRenameEvent,
} from "@pierre/trees";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { canonicalizeTreePath } from "renderer/lib/pierreTree";
import {
	buildCreationKey,
	CREATION_BASE_NAME,
	deriveCreationParent,
} from "../../utils/creationPaths";
import type {
	ProvisionalEntry,
	ProvisionalEvent,
} from "../../utils/provisionalEntry";
import { reduceProvisional } from "../../utils/provisionalEntry";
import {
	asDirectoryHandle,
	moveDestinationPath,
	parentRel,
	stripTrailingSlash,
	toAbs,
	toRel,
} from "../../utils/treePath";
import { withinWorkspace } from "../../utils/workspace-path";
import type { FilesTabBridge } from "../useFilesTabBridge";

interface UseFilesTabActionsOptions {
	model: FileTree;
	bridge: FilesTabBridge;
	rootPath: string;
	workspaceId: string;
	client: LocalClient;
	onFileMove(event: FsWatchEvent): void;
	onRequestDelete(path: string, name: string, isDirectory: boolean): void;
}

export interface FilesTabActions {
	isPending: boolean;
	reveal(absolutePath: string, isDirectory: boolean): Promise<void>;
	startCreating(mode: "file" | "folder", parentAbs?: string): Promise<void>;
	handleRename(event: FileTreeRenameEvent): Promise<void>;
	handleMove(event: FileTreeDropResult): Promise<void>;
	handleRenameError(message: string): void;
	handleDelete(absolutePath: string, name: string, isDirectory: boolean): void;
	collapseAll(): void;
}

export function useFilesTabActions({
	model,
	bridge,
	rootPath,
	workspaceId,
	client,
	onFileMove,
	onRequestDelete,
}: UseFilesTabActionsOptions): FilesTabActions {
	const { t } = useLingui();
	const [mutationCount, setMutationCount] = useState(0);

	const createUniqueEntry = useMemo(
		() => ({
			mutateAsync: async (
				...args: Parameters<typeof client.filesystem.createUniqueEntry.mutate>
			) => {
				setMutationCount((value) => value + 1);
				try {
					return await client.filesystem.createUniqueEntry.mutate(...args);
				} finally {
					setMutationCount((value) => value - 1);
				}
			},
		}),
		[client],
	);
	const removeEmptyDirectory = useMemo(
		() => ({
			mutateAsync: async (
				...args: Parameters<
					typeof client.filesystem.removeEmptyDirectory.mutate
				>
			) => {
				setMutationCount((value) => value + 1);
				try {
					return await client.filesystem.removeEmptyDirectory.mutate(...args);
				} finally {
					setMutationCount((value) => value - 1);
				}
			},
		}),
		[client],
	);
	const removeFileIfUnchanged = useMemo(
		() => ({
			mutateAsync: async (
				...args: Parameters<
					typeof client.filesystem.removeFileIfUnchanged.mutate
				>
			) => {
				setMutationCount((value) => value + 1);
				try {
					return await client.filesystem.removeFileIfUnchanged.mutate(...args);
				} finally {
					setMutationCount((value) => value - 1);
				}
			},
		}),
		[client],
	);
	const movePath = useMemo(
		() => ({
			mutateAsync: async (
				...args: Parameters<typeof client.filesystem.movePath.mutate>
			) => {
				setMutationCount((value) => value + 1);
				try {
					return await client.filesystem.movePath.mutate(...args);
				} finally {
					setMutationCount((value) => value - 1);
				}
			},
		}),
		[client],
	);

	const provisionalRef = useRef<ProvisionalEntry | null>(null);
	const provisionalWorkspaceRef = useRef<string>("");

	const reveal = useCallback(
		async (absolutePath: string, isDirectory: boolean): Promise<void> => {
			if (!rootPath || !withinWorkspace(rootPath, absolutePath)) return;
			const rel = toRel(rootPath, absolutePath);
			if (!rel) return;
			await bridge.fetchDir("");

			const segments = rel.split("/");
			let acc = "";
			for (let i = 0; i < segments.length - 1; i++) {
				acc = acc ? `${acc}/${segments[i]}` : segments[i];
				const dirKey = `${acc}/`;
				if (!bridge.knownPaths.has(dirKey)) {
					await bridge.fetchDir(parentRel(acc));
				}
				const handle = asDirectoryHandle(model.getItem(dirKey));
				if (handle && !handle.isExpanded()) {
					handle.expand();
					await bridge.fetchDir(acc);
				}
			}
			if (isDirectory) {
				const dirKey = `${rel}/`;
				const handle = asDirectoryHandle(model.getItem(dirKey));
				if (handle && !handle.isExpanded()) {
					handle.expand();
					await bridge.fetchDir(rel);
				}
			}

			requestAnimationFrame(() => {
				const targetKey = isDirectory ? `${rel}/` : rel;
				for (const selectedPath of model.getSelectedPaths()) {
					if (selectedPath === targetKey) continue;
					model.getItem(selectedPath)?.deselect();
				}
				model.getItem(targetKey)?.select();
				model.focusPath(rel);
				model.scrollToPath(targetKey, { offset: "nearest", focus: false });
			});
		},
		[model, rootPath, bridge.fetchDir, bridge.knownPaths],
	);

	const discardProvisional = useCallback(
		async (entry: ProvisionalEntry): Promise<boolean> => {
			if (entry.mode === "folder") {
				const result = await removeEmptyDirectory.mutateAsync({
					workspaceId,
					absolutePath: entry.absolutePath,
				});
				return result.ok;
			}
			if (entry.revision === undefined) return false;
			const result = await removeFileIfUnchanged.mutateAsync({
				workspaceId,
				absolutePath: entry.absolutePath,
				revision: entry.revision,
			});
			return result.ok;
		},
		[workspaceId, removeEmptyDirectory, removeFileIfUnchanged],
	);

	const dispatchProvisional = useCallback(
		(event: ProvisionalEvent): void => {
			const { state, action } = reduceProvisional(
				provisionalRef.current,
				event,
			);
			provisionalRef.current = state;

			if (action.type !== "cleanup") return;

			const { entry } = action;
			void discardProvisional(entry)
				.then((removed) => {
					if (removed || !bridge.isCurrent(entry.versionToken)) return;
					bridge.addPath(entry.key);
					toast.info(
						entry.mode === "folder"
							? t({
									message: "Kept the new folder because it is no longer empty",
								})
							: t({
									message:
										"Kept the new file because it changed after it was created",
								}),
					);
				})
				.catch((error) => {
					if (!bridge.isCurrent(entry.versionToken)) return;
					bridge.addPath(entry.key);
					toast.error(
						t({
							message: "Failed to discard the new item",
						}),
						{
							description: error instanceof Error ? error.message : undefined,
						},
					);
				});
		},
		[bridge, discardProvisional, t],
	);

	const startCreating = useCallback(
		async (mode: "file" | "folder", parentAbs?: string): Promise<void> => {
			if (!rootPath) return;
			const parentAbsPath =
				parentAbs ??
				deriveCreationParent(
					model.getSelectedPaths(),
					bridge.knownPaths,
					rootPath,
				);
			const parentRelPath = toRel(rootPath, parentAbsPath);
			const parentDirKey = parentRelPath ? `${parentRelPath}/` : "";
			const versionToken = bridge.getVersion();
			if (parentRelPath) {
				await bridge.fetchDir(parentRelPath);
				if (!bridge.isCurrent(versionToken)) return;
				const handle = asDirectoryHandle(model.getItem(parentDirKey));
				if (handle && !handle.isExpanded()) {
					handle.expand();
				}
			}
			let created: Awaited<ReturnType<typeof createUniqueEntry.mutateAsync>>;
			try {
				created = await createUniqueEntry.mutateAsync({
					workspaceId,
					parentAbsolutePath: parentAbsPath,
					baseName: CREATION_BASE_NAME[mode],
					kind: mode === "folder" ? "directory" : "file",
				});
			} catch (error) {
				if (!bridge.isCurrent(versionToken)) return;
				toast.error(
					t({
						message: "Failed to create item",
					}),
					{
						description: error instanceof Error ? error.message : undefined,
					},
				);
				return;
			}

			if (!created.ok) {
				if (!bridge.isCurrent(versionToken)) return;
				toast.error(
					t({
						message: "Failed to create item",
					}),
					{
						description:
							created.reason === "exhausted"
								? t({
										message: "Too many untitled items here already.",
									})
								: t({
										message: "That name isn't allowed.",
									}),
					},
				);
				return;
			}

			const entry: ProvisionalEntry = {
				key: buildCreationKey(parentRelPath, created.name, mode),
				absolutePath: created.absolutePath,
				mode,
				revision: created.revision,
				rootPath,
				versionToken,
			};
			if (!bridge.isCurrent(versionToken)) {
				void discardProvisional(entry).catch(() => {});
				return;
			}
			if (!bridge.addPath(entry.key)) {
				void discardProvisional(entry).catch(() => {});
				toast.error(
					t({
						message: "Failed to create item",
					}),
				);
				return;
			}

			if (!model.startRenaming(entry.key, { removeIfCanceled: true })) {
				void discardProvisional(entry).catch(() => {});
				bridge.removePath(entry.key);
				toast.error(
					t({
						message: "Failed to create item",
					}),
				);
				return;
			}
			dispatchProvisional({ type: "created", entry });
		},
		[
			model,
			rootPath,
			workspaceId,
			bridge,
			createUniqueEntry,
			discardProvisional,
			dispatchProvisional,
			t,
		],
	);
	useEffect(() => {
		return model.onMutation("remove", (event) => {
			dispatchProvisional({
				type: "removed",
				path: event.path,
				rootPath,
				versionToken: bridge.getVersion(),
			});
		});
	}, [model, rootPath, bridge, dispatchProvisional]);
	useEffect(() => {
		const identity = `${workspaceId}:${rootPath}`;
		if (provisionalWorkspaceRef.current === identity) return;
		provisionalWorkspaceRef.current = identity;
		dispatchProvisional({ type: "workspace-changed" });
	}, [workspaceId, rootPath, dispatchProvisional]);

	const handleRename = useCallback(
		async (event: FileTreeRenameEvent): Promise<void> => {
			if (!rootPath) return;
			const { isFolder } = event;
			const sourcePath = canonicalizeTreePath(event.sourcePath, isFolder);
			const destinationPath = canonicalizeTreePath(
				event.destinationPath,
				isFolder,
			);
			dispatchProvisional({ type: "renamed", sourceKey: sourcePath });
			const versionToken = bridge.getVersion();
			bridge.knownPaths.delete(sourcePath);
			bridge.knownPaths.add(destinationPath);
			if (isFolder) {
				bridge.rekeyDescendants(
					stripTrailingSlash(sourcePath),
					stripTrailingSlash(destinationPath),
				);
			}
			try {
				await movePath.mutateAsync({
					workspaceId,
					sourceAbsolutePath: toAbs(rootPath, sourcePath),
					destinationAbsolutePath: toAbs(rootPath, destinationPath),
				});
				if (!bridge.isCurrent(versionToken)) return;
				onFileMove?.({
					kind: "rename",
					oldAbsolutePath: toAbs(rootPath, sourcePath),
					absolutePath: toAbs(rootPath, destinationPath),
					isDirectory: isFolder,
				});
			} catch (error) {
				if (!bridge.isCurrent(versionToken)) return;
				try {
					model.move(destinationPath, sourcePath);
					bridge.knownPaths.delete(destinationPath);
					bridge.knownPaths.add(sourcePath);
					if (isFolder) {
						bridge.rekeyDescendants(
							stripTrailingSlash(destinationPath),
							stripTrailingSlash(sourcePath),
						);
					}
				} catch {}
				toast.error(
					t({
						message: "Failed to rename",
					}),
					{
						description: error instanceof Error ? error.message : undefined,
					},
				);
			}
		},
		[
			model,
			rootPath,
			workspaceId,
			movePath,
			onFileMove,
			bridge,
			dispatchProvisional,
			t,
		],
	);

	const handleRenameError = useCallback(
		(message: string): void => {
			toast.error(message);
			dispatchProvisional({ type: "rename-error" });
		},
		[dispatchProvisional],
	);

	const handleMove = useCallback(
		async (event: FileTreeDropResult): Promise<void> => {
			if (!rootPath) return;
			const versionToken = bridge.getVersion();

			for (const sourcePath of event.draggedPaths) {
				if (!bridge.isCurrent(versionToken)) return;
				const destinationPath = moveDestinationPath(
					sourcePath,
					event.target.directoryPath,
				);
				if (sourcePath === destinationPath) continue;

				try {
					await movePath.mutateAsync({
						workspaceId,
						sourceAbsolutePath: toAbs(rootPath, sourcePath),
						destinationAbsolutePath: toAbs(rootPath, destinationPath),
					});
					if (!bridge.isCurrent(versionToken)) return;
					const isFolder = sourcePath.endsWith("/");
					onFileMove?.({
						kind: "rename",
						oldAbsolutePath: toAbs(rootPath, sourcePath),
						absolutePath: toAbs(rootPath, destinationPath),
						isDirectory: isFolder,
					});
					bridge.knownPaths.delete(sourcePath);
					bridge.knownPaths.add(destinationPath);
					if (isFolder) {
						bridge.rekeyDescendants(
							stripTrailingSlash(sourcePath),
							stripTrailingSlash(destinationPath),
						);
					}
				} catch (error) {
					if (!bridge.isCurrent(versionToken)) return;
					void bridge.doRefresh();
					toast.error(
						t({
							message: "Failed",
						}),
						{
							description: error instanceof Error ? error.message : undefined,
						},
					);
					return;
				}
			}
		},
		[bridge, movePath, onFileMove, rootPath, t, workspaceId],
	);

	const handleDelete = onRequestDelete;

	const collapseAll = useCallback(() => {
		for (const path of bridge.knownPaths) {
			if (!path.endsWith("/")) continue;
			const handle = asDirectoryHandle(model.getItem(path));
			if (handle?.isExpanded()) {
				handle.collapse();
			}
		}
	}, [model, bridge.knownPaths]);

	return {
		isPending: mutationCount > 0,
		reveal,
		startCreating,
		handleRename,
		handleMove,
		handleRenameError,
		handleDelete,
		collapseAll,
	};
}
