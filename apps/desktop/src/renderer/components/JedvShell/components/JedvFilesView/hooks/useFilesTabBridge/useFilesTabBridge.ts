import { useLingui } from "@lingui/react/macro";
import type { FileTree } from "@pierre/trees";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { purgeDirectory, rekeyDirectory } from "../../utils/treeBookkeeping";
import {
	asDirectoryHandle,
	stripTrailingSlash,
	toAbs,
} from "../../utils/treePath";
import { workspaceRelativePath } from "../../utils/workspace-path";

export function useFilesTabBridge({
	model,
	client,
	workspaceId,
	rootPath,
	refreshRevision,
	includeHidden,
}: {
	model: FileTree;
	client: LocalClient;
	workspaceId: string;
	rootPath: string;
	refreshRevision: number;
	includeHidden: boolean;
}) {
	const { t } = useLingui();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [revision, setRevision] = useState(0);
	const knownPaths = useRef(new Set<string>()).current;
	const loadedDirs = useRef(new Set<string>()).current;
	const unloadedDirCandidates = useRef(new Set<string>()).current;
	const inflight = useRef(new Map<string, Promise<void>>());
	const generation = useRef(0);
	const identity = useRef(0);
	useEffect(() => {
		void client;
		void workspaceId;
		void rootPath;
		knownPaths.clear();
		loadedDirs.clear();
		unloadedDirCandidates.clear();
		model.resetPaths([]);
		identity.current++;
		return () => {
			identity.current++;
		};
	}, [
		client,
		workspaceId,
		rootPath,
		knownPaths,
		loadedDirs,
		unloadedDirCandidates,
		model,
	]);
	const bookkeeping = { knownPaths, loadedDirs, unloadedDirCandidates };
	const addPath = useCallback(
		(path: string) => {
			if (knownPaths.has(path)) return true;
			if (knownPaths.size >= 5000) {
				setError(
					t({
						message:
							"File tree limit reached. Search files to open an unloaded path.",
					}),
				);
				return false;
			}
			try {
				toAbs(rootPath, path);
				model.add(path);
				knownPaths.add(path);
				if (path.endsWith("/"))
					unloadedDirCandidates.add(stripTrailingSlash(path));
				return true;
			} catch {
				return false;
			}
		},
		[model, knownPaths, unloadedDirCandidates, rootPath, t],
	);
	const fetchDir = useCallback(
		(relative: string): Promise<void> => {
			if (loadedDirs.has(relative)) return Promise.resolve();
			const pending = inflight.current.get(relative);
			if (pending) return pending;
			const token = generation.current;
			const promise = (async () => {
				try {
					const { entries } = await client.filesystem.listDirectory.query({
						workspaceId,
						absolutePath: toAbs(rootPath, relative),
					});
					if (token !== generation.current) return;
					const actual = new Set(
						entries
							.filter(
								(entry) =>
									entry.kind !== "other" &&
									entry.kind !== "symlink" &&
									(includeHidden || !entry.name.startsWith(".")),
							)
							.map((entry) =>
								workspaceRelativePath(rootPath, entry.absolutePath),
							)
							.filter((path): path is string => !!path),
					);
					for (const path of [...knownPaths]) {
						const plain = stripTrailingSlash(path);
						const parent = plain.includes("/")
							? plain.slice(0, plain.lastIndexOf("/"))
							: "";
						if (parent === relative && !actual.has(plain)) {
							model.remove(path);
							knownPaths.delete(path);
							purgeDirectory(
								{ knownPaths, loadedDirs, unloadedDirCandidates },
								plain,
							);
						}
					}
					for (const entry of entries) {
						const path = workspaceRelativePath(rootPath, entry.absolutePath);
						if (
							!path ||
							entry.kind === "other" ||
							(!includeHidden &&
								path.split("/").some((part) => part.startsWith(".")))
						)
							continue;
						if (entry.kind === "symlink") continue;
						if (!addPath(entry.kind === "directory" ? `${path}/` : path)) break;
					}
					loadedDirs.add(relative);
					unloadedDirCandidates.delete(relative);
				} catch (cause) {
					if (token === generation.current)
						setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (token === generation.current) inflight.current.delete(relative);
				}
			})();
			inflight.current.set(relative, promise);
			return promise;
		},
		[
			client,
			workspaceId,
			rootPath,
			loadedDirs,
			unloadedDirCandidates,
			includeHidden,
			knownPaths,
			model,
			addPath,
		],
	);
	const doRefresh = useCallback(async () => {
		generation.current++;
		inflight.current.clear();
		setLoading(true);
		setError(null);
		const expanded = [...knownPaths]
			.filter((path) => asDirectoryHandle(model.getItem(path))?.isExpanded())
			.map(stripTrailingSlash);
		const previousLoaded = [...loadedDirs];
		loadedDirs.clear();
		const token = generation.current;
		await fetchDir("");
		for (const path of [
			...new Set([...expanded, ...previousLoaded.filter(Boolean)]),
		].sort((a, b) => a.split("/").length - b.split("/").length)) {
			if (token !== generation.current) return;
			const handle = asDirectoryHandle(model.getItem(`${path}/`));
			if (handle) {
				if (expanded.includes(path)) handle.expand();
				await fetchDir(path);
			}
		}
		if (token === generation.current) setLoading(false);
	}, [model, fetchDir, knownPaths, loadedDirs]);
	useEffect(() => {
		void refreshRevision;
		void revision;
		void doRefresh();
		return () => {
			generation.current++;
		};
	}, [doRefresh, refreshRevision, revision]);
	useEffect(
		() =>
			model.subscribe(() => {
				for (const path of unloadedDirCandidates)
					if (asDirectoryHandle(model.getItem(`${path}/`))?.isExpanded())
						void fetchDir(path);
			}),
		[model, fetchDir, unloadedDirCandidates],
	);
	useEffect(
		() =>
			model.onMutation("remove", (event) => {
				knownPaths.delete(event.path);
				if (event.path.endsWith("/"))
					purgeDirectory(
						{ knownPaths, loadedDirs, unloadedDirCandidates },
						stripTrailingSlash(event.path),
					);
			}),
		[model, knownPaths, loadedDirs, unloadedDirCandidates],
	);
	return {
		knownPaths,
		loadedDirs,
		addPath,
		fetchDir,
		doRefresh,
		error,
		loading,
		isRefreshing: loading,
		removePath(path: string) {
			try {
				model.remove(path);
			} finally {
				knownPaths.delete(path);
				purgeDirectory(bookkeeping, stripTrailingSlash(path));
			}
		},
		rekeyDescendants(oldDir: string, newDir: string) {
			inflight.current.clear();
			rekeyDirectory(bookkeeping, oldDir, newDir);
		},
		getVersion: () => identity.current,
		isCurrent: (token: number) => identity.current === token,
		refresh: () => setRevision((value) => value + 1),
	};
}
export type FilesTabBridge = ReturnType<typeof useFilesTabBridge>;
