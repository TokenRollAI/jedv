import { i18n } from "@jedv/i18n";
import { MAX_INLINE_ATTACHMENT_BYTES } from "@jedv/shared/attachment-limits";
import { toast } from "@jedv/ui/sonner";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { FileTree } from "@pierre/trees";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalClient } from "renderer/components/JedvShell/local-client";

import { fileToBase64 } from "renderer/lib/file-to-base64";
import {
	asDirectoryHandle,
	basename,
	parentRel,
	stripTrailingSlash,
	toAbs,
} from "../../utils/treePath";
import type { FilesTabBridge } from "../useFilesTabBridge";

export interface UploadConfirmation {
	title: string;
	description: string;
	actions: { label: string; variant: string; onClick?: () => Promise<void> }[];
}

interface UseFilesTabDropOptions {
	model: FileTree;
	bridge: FilesTabBridge;
	rootPath: string;
	workspaceId: string;
	client: LocalClient;
	requestConfirmation(options: UploadConfirmation): void;
}

export interface DropRowRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface FilesTabDropTarget {
	dirRel: string;
	label: string;
	rect: DropRowRect | null;
}

export interface FilesTabDrop {
	dropTarget: FilesTabDropTarget | null;
	onDragOver(e: React.DragEvent<HTMLElement>): void;
	onDragLeave(e: React.DragEvent<HTMLElement>): void;
	onDrop(e: React.DragEvent<HTMLElement>): void;
}

interface DroppedFile {
	relPath: string;
	file: File;
}

interface DroppedTree {
	files: DroppedFile[];
	dirs: string[];
}

function dragHasFiles(e: React.DragEvent): boolean {
	return Array.from(e.dataTransfer.types).includes("Files");
}

function findRowUnderCursor(e: React.DragEvent): HTMLElement | null {
	for (const node of e.nativeEvent.composedPath()) {
		if (node instanceof HTMLElement && node.getAttribute("data-item-path")) {
			return node;
		}
	}
	return null;
}

function rowToDirRel(row: HTMLElement | null): string {
	const itemPath = row?.getAttribute("data-item-path");
	if (!itemPath) return "";
	return itemPath.endsWith("/")
		? stripTrailingSlash(itemPath)
		: parentRel(itemPath);
}

function resolveDropDirRel(e: React.DragEvent): string {
	return rowToDirRel(findRowUnderCursor(e));
}

function dirLabel(dirRel: string): string {
	return dirRel === ""
		? i18n._(
				msg({
					message: "workspace root",
				}),
			)
		: basename(dirRel);
}

function findDirRow(sibling: HTMLElement, dirRel: string): HTMLElement | null {
	const root = sibling.getRootNode();
	if (!(root instanceof ShadowRoot || root instanceof Document)) return null;
	return root.querySelector<HTMLElement>(
		`[data-item-path=${CSS.escape(`${dirRel}/`)}]`,
	);
}

function resolveDropTarget(
	e: React.DragEvent<HTMLElement>,
): FilesTabDropTarget {
	const row = findRowUnderCursor(e);
	const dirRel = rowToDirRel(row);
	const destRow = dirRel && row ? findDirRow(row, dirRel) : null;

	let rect: DropRowRect | null = null;
	if (destRow) {
		const wrapper = e.currentTarget.getBoundingClientRect();
		const r = destRow.getBoundingClientRect();
		rect = {
			top: r.top - wrapper.top,
			left: r.left - wrapper.left,
			width: r.width,
			height: r.height,
		};
	}

	return { dirRel, label: dirLabel(dirRel), rect };
}

function rectsEqual(a: DropRowRect | null, b: DropRowRect | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.top === b.top &&
		a.left === b.left &&
		a.width === b.width &&
		a.height === b.height
	);
}

function targetsEqual(
	a: FilesTabDropTarget | null,
	b: FilesTabDropTarget,
): boolean {
	return a !== null && a.dirRel === b.dirRel && rectsEqual(a.rect, b.rect);
}

function collectDroppedEntries(e: React.DragEvent): {
	entries: FileSystemEntry[];
	fallbackFiles: File[];
} {
	const items = Array.from(e.dataTransfer.items);
	const supportsEntries =
		items.length > 0 && typeof items[0].webkitGetAsEntry === "function";

	if (!supportsEntries) {
		return { entries: [], fallbackFiles: Array.from(e.dataTransfer.files) };
	}

	const entries: FileSystemEntry[] = [];
	for (const item of items) {
		if (item.kind !== "file") continue;
		const entry = item.webkitGetAsEntry();
		if (entry) entries.push(entry);
	}
	return { entries, fallbackFiles: [] };
}

function getFile(entry: FileSystemFileEntry): Promise<File> {
	return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readAllEntries(
	reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
	const all: FileSystemEntry[] = [];
	while (true) {
		const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
			reader.readEntries(resolve, reject),
		);
		if (batch.length === 0) break;
		all.push(...batch);
	}
	return all;
}

async function flattenEntry(
	entry: FileSystemEntry,
	prefix: string,
): Promise<DroppedTree> {
	if (entry.isFile) {
		const file = await getFile(entry as FileSystemFileEntry);
		return { files: [{ relPath: `${prefix}${entry.name}`, file }], dirs: [] };
	}

	const dirRel = `${prefix}${entry.name}`;
	const children = await readAllEntries(
		(entry as FileSystemDirectoryEntry).createReader(),
	);
	const subtrees = await Promise.all(
		children.map((child) => flattenEntry(child, `${dirRel}/`)),
	);
	return {
		files: subtrees.flatMap((t) => t.files),
		dirs: [dirRel, ...subtrees.flatMap((t) => t.dirs)],
	};
}

async function flattenEntries(
	entries: FileSystemEntry[],
): Promise<DroppedTree> {
	const trees = await Promise.all(
		entries.map((entry) => flattenEntry(entry, "")),
	);
	return {
		files: trees.flatMap((t) => t.files),
		dirs: trees.flatMap((t) => t.dirs),
	};
}

export function useFilesTabDrop({
	model,
	bridge,
	rootPath,
	workspaceId,
	client,
	requestConfirmation,
}: UseFilesTabDropOptions): FilesTabDrop {
	const { t } = useLingui();
	const writeFile = useMemo(
		() => ({ mutateAsync: client.filesystem.writeFile.mutate }),
		[client],
	);
	const createDirectory = useMemo(
		() => ({ mutateAsync: client.filesystem.createDirectory.mutate }),
		[client],
	);
	const [dropTarget, setDropTarget] = useState<FilesTabDropTarget | null>(null);
	useEffect(() => {
		const clear = () => setDropTarget(null);
		window.addEventListener("dragend", clear);
		window.addEventListener("drop", clear);
		return () => {
			window.removeEventListener("dragend", clear);
			window.removeEventListener("drop", clear);
		};
	}, []);

	const uploadDropped = useCallback(
		async (
			dirRel: string,
			entries: FileSystemEntry[],
			fallbackFiles: File[],
		): Promise<void> => {
			const destDirAbs = toAbs(rootPath, dirRel);
			const versionToken = bridge.getVersion();

			let tree: DroppedTree;
			try {
				tree =
					entries.length > 0
						? await flattenEntries(entries)
						: {
								files: fallbackFiles.map((file) => ({
									relPath: file.name,
									file,
								})),
								dirs: [],
							};
			} catch {
				if (bridge.isCurrent(versionToken)) {
					toast.error(
						t({
							message: "Could not read the dropped files",
						}),
					);
				}
				return;
			}

			if (!bridge.isCurrent(versionToken)) return;
			if (tree.files.length + tree.dirs.length > 5000) {
				toast.error(
					t({
						message:
							"Too many dropped items. Add at most 5000 files and folders at a time.",
					}),
				);
				return;
			}

			if (tree.files.length === 0 && tree.dirs.length === 0) {
				toast.error(
					t({
						message: "Could not read the dropped files",
					}),
				);
				return;
			}
			const dirs = Array.from(new Set(tree.dirs)).sort(
				(a, b) => a.split("/").length - b.split("/").length,
			);
			let createdDirs = 0;
			let failedDirs = 0;
			for (const relDir of dirs) {
				if (!bridge.isCurrent(versionToken)) return;
				try {
					await createDirectory.mutateAsync({
						workspaceId,
						absolutePath: toAbs(destDirAbs, relDir),
						recursive: true,
					});
					createdDirs += 1;
				} catch (error) {
					failedDirs += 1;
					console.error("[v2 FilesTab] createDirectory failed", {
						relDir,
						error,
					});
				}
			}
			const collisionRevisions = new Map<string, string>();
			const writeOneFile = async (
				relPath: string,
				file: File,
				overwrite: boolean,
			): Promise<"ok" | "exists"> => {
				const data = await fileToBase64(file);
				const result = await writeFile.mutateAsync({
					workspaceId,
					absolutePath: toAbs(destDirAbs, relPath),
					precondition: overwrite
						? { ifMatch: collisionRevisions.get(relPath) ?? "" }
						: undefined,
					content: { kind: "base64", data },
					options: { create: true, overwrite },
				});
				if (result && result.ok === false) {
					if (!overwrite && result.reason === "exists") {
						const metadata = await client.filesystem.getMetadata.query({
							workspaceId,
							absolutePath: toAbs(destDirAbs, relPath),
						});
						if (!metadata || metadata.kind !== "file")
							throw new Error("The destination is not a regular file");
						collisionRevisions.set(relPath, metadata.revision);
						return "exists";
					}
					throw new Error(result.reason ?? "write failed");
				}
				return "ok";
			};
			const isTooLarge = (file: File) =>
				file.size > MAX_INLINE_ATTACHMENT_BYTES;
			const tooLarge = tree.files.filter(({ file }) => isTooLarge(file));
			if (tooLarge.length > 0) {
				const count = tooLarge.length;
				const limit = `${Math.round(MAX_INLINE_ATTACHMENT_BYTES / 1024 / 1024)}MB`;
				toast.error(
					tooLarge.length === 1
						? t({
								message: `1 file is over ${limit} and was not added`,
							})
						: t({
								message: `${count} files are over ${limit} and were not added`,
							}),
				);
			}

			let added = 0;
			let failed = 0;
			const collisions: DroppedFile[] = [];
			for (const { relPath, file } of tree.files) {
				if (isTooLarge(file)) continue;
				if (!bridge.isCurrent(versionToken)) break;
				try {
					if ((await writeOneFile(relPath, file, false)) === "exists") {
						collisions.push({ relPath, file });
					} else {
						added += 1;
					}
				} catch (error) {
					failed += 1;
					console.error("[v2 FilesTab] upload failed", { relPath, error });
				}
			}
			if (!bridge.isCurrent(versionToken)) return;

			const where = dirLabel(dirRel);
			if (added > 0) {
				toast.success(
					added === 1
						? t({
								message: `Added 1 file to ${where}`,
							})
						: t({
								message: `Added ${added} files to ${where}`,
							}),
				);
			} else if (createdDirs > 0 && failed === 0 && failedDirs === 0) {
				toast.success(
					createdDirs === 1
						? t({
								message: `Created 1 folder in ${where}`,
							})
						: t({
								message: `Created ${createdDirs} folders in ${where}`,
							}),
				);
			}
			if (failed > 0) {
				toast.error(
					failed === 1
						? t({
								message: "Failed to add 1 file",
							})
						: t({
								message: `Failed to add ${failed} files`,
							}),
				);
			} else if (failedDirs > 0) {
				toast.error(
					failedDirs === 1
						? t({
								message: "Failed to create 1 folder",
							})
						: t({
								message: `Failed to create ${failedDirs} folders`,
							}),
				);
			}
			if (added > 0 || createdDirs > 0) {
				if (dirRel) {
					const handle = asDirectoryHandle(model.getItem(`${dirRel}/`));
					if (handle && !handle.isExpanded()) handle.expand();
				}
				void bridge.fetchDir(dirRel);
			}
			if (collisions.length === 0) return;
			const many = collisions.length > 1;
			const firstName = basename(collisions[0].relPath);
			requestConfirmation({
				title: many
					? t({
							message: `${collisions.length} files already exist in ${where}. Do you want to replace them?`,
						})
					: t({
							message: `A file named '${firstName}' already exists in ${where}. Do you want to replace it?`,
						}),
				description:
					t({
						message: "This action is irreversible.",
					}) +
					"\n\n" +
					collisions.map((file) => file.relPath).join("\n"),
				actions: [
					{
						label: many
							? t({
									message: "Replace All",
								})
							: t({
									message: "Replace",
								}),
						variant: "destructive",
						onClick: async () => {
							let replaced = 0;
							let replaceFailed = 0;
							for (const { relPath, file } of collisions) {
								if (!bridge.isCurrent(versionToken)) break;
								try {
									await writeOneFile(relPath, file, true);
									replaced += 1;
								} catch (error) {
									replaceFailed += 1;
									console.error("[v2 FilesTab] replace failed", {
										relPath,
										error,
									});
								}
							}
							if (!bridge.isCurrent(versionToken)) return;
							if (replaced > 0) {
								toast.success(
									replaced === 1
										? t({
												message: `Replaced 1 file in ${where}`,
											})
										: t({
												message: `Replaced ${replaced} files in ${where}`,
											}),
								);
							}
							if (replaceFailed > 0) {
								toast.error(
									replaceFailed === 1
										? t({
												message: "Failed to replace 1 file",
											})
										: t({
												message: `Failed to replace ${replaceFailed} files`,
											}),
								);
							}
						},
					},
					{
						label: t({
							message: "Cancel",
						}),
						variant: "ghost",
					},
				],
			});
		},
		[
			model,
			bridge,
			writeFile,
			createDirectory,
			rootPath,
			workspaceId,
			client,
			requestConfirmation,
			t,
		],
	);

	const onDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		const next = resolveDropTarget(e);
		setDropTarget((prev) => (targetsEqual(prev, next) ? prev : next));
	}, []);

	const onDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		const { clientX, clientY } = e;
		if (
			clientX < rect.left ||
			clientX > rect.right ||
			clientY < rect.top ||
			clientY > rect.bottom
		) {
			setDropTarget(null);
		}
	}, []);

	const onDrop = useCallback(
		(e: React.DragEvent<HTMLElement>) => {
			if (!dragHasFiles(e)) return;
			e.preventDefault();
			e.stopPropagation();
			setDropTarget(null);
			if (!rootPath || !workspaceId) return;
			const dirRel = resolveDropDirRel(e);
			const { entries, fallbackFiles } = collectDroppedEntries(e);

			if (entries.length === 0 && fallbackFiles.length === 0) {
				toast.error(
					t({
						message: "Could not read the dropped files",
					}),
				);
				return;
			}

			void uploadDropped(dirRel, entries, fallbackFiles);
		},
		[rootPath, workspaceId, uploadDropped, t],
	);

	return { dropTarget, onDragOver, onDragLeave, onDrop };
}
