import type {
	FileTreeDirectoryHandle,
	FileTreeRowDecoration,
	FileTreeRowDecorationContext,
} from "@pierre/trees";
import { useFileTree } from "@pierre/trees/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFallthroughIcons } from "renderer/lib/fileIcons";
import {
	buildCollisionSafeTreePaths,
	diffStatsDecoration,
	FILE_STATUS_TO_PIERRE,
	type FileStatus,
	PIERRE_TREE_UNSAFE_CSS,
	type PierreGitStatusEntry,
	stripTrailingSlash,
} from "renderer/lib/pierreTree";
import { type FoldSignal, isFoldCollapsed } from "../useFoldSignal";
import { buildTreeShape } from "./utils/buildTreeShape";
import { planExpansion, recordExpansion } from "./utils/carryExpansion";

const ITEM_HEIGHT = 24;

export interface ChangedFileEntry {
	path: string;
	status: FileStatus;
	additions: number | null;
	deletions: number | null;
}

interface UseChangedFilesTreeParams<T extends ChangedFileEntry> {
	files: T[];
	foldSignal: FoldSignal;
	onSelectFile: (file: T) => void;
	selectedPath?: string | null;
	flattenEmptyDirectories?: boolean;
	unsafeCSS?: string;
}

export function useChangedFilesTree<T extends ChangedFileEntry>({
	files,
	foldSignal,
	onSelectFile,
	selectedPath,
	flattenEmptyDirectories,
	unsafeCSS = "",
}: UseChangedFilesTreeParams<T>) {
	const pathKey = files.map((f) => f.path).join("\0");
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathKey serializes all file paths so new array instances with identical paths keep stable tree structures
	const { treePaths, toTreePath, toRealPath } = useMemo(
		() => buildCollisionSafeTreePaths(files.map((f) => f.path)),
		[pathKey],
	);
	const fileByTreePath = useMemo(() => {
		const map = new Map<string, T>();
		for (const file of files)
			map.set(toTreePath.get(file.path) ?? file.path, file);
		return map;
	}, [files, toTreePath]);
	const { dirs, dirFileCount, chainDirs } = useMemo(
		() => buildTreeShape(treePaths),
		[treePaths],
	);

	const expansionRef = useRef({
		known: new Map<string, boolean>(),
		defaultOpen: !isFoldCollapsed(foldSignal),
	});
	const selectedTreePath =
		selectedPath == null
			? null
			: (toTreePath.get(selectedPath) ?? selectedPath);
	const [initial] = useState(() => ({
		gitStatus: buildGitStatus(files, toTreePath),
		expandedPaths: expansionRef.current.defaultOpen ? dirs : [],
		selectedPaths:
			selectedTreePath && fileByTreePath.has(selectedTreePath)
				? [selectedTreePath]
				: undefined,
	}));
	const handlersRef = useRef({
		onSelect(_treePath: string) {},
		renderRowDecoration(
			_ctx: FileTreeRowDecorationContext,
		): FileTreeRowDecoration | null {
			return null;
		},
	});

	const { model } = useFileTree({
		paths: treePaths,
		initialExpansion: "closed",
		initialExpandedPaths: initial.expandedPaths,
		initialSelectedPaths: initial.selectedPaths,
		flattenEmptyDirectories,
		search: false,
		unsafeCSS: PIERRE_TREE_UNSAFE_CSS + unsafeCSS,
		gitStatus: initial.gitStatus,
		icons: { set: "complete", colored: true },
		itemHeight: ITEM_HEIGHT,
		overscan: 20,
		stickyFolders: true,
		onSelectionChange: (selected) => {
			const last = selected[selected.length - 1];
			if (!last || last.endsWith("/")) return;
			handlersRef.current.onSelect(last);
		},
		renderRowDecoration: (ctx) => handlersRef.current.renderRowDecoration(ctx),
	});

	const isDirExpanded = useCallback(
		(dir: string) => {
			const handle = model.getItem(`${dir}/`);
			return handle?.isDirectory() === true
				? (handle as FileTreeDirectoryHandle).isExpanded()
				: undefined;
		},
		[model],
	);

	const shapeRef = useRef({ treePaths, dirs, chainDirs });
	useEffect(() => {
		const previous = shapeRef.current;
		if (previous.treePaths === treePaths) return;
		const { known, defaultOpen } = expansionRef.current;
		const flattened = flattenEmptyDirectories === true;
		recordExpansion(previous, isDirExpanded, known, flattened);
		const { expand, collapse } = planExpansion(
			{ dirs, chainDirs },
			known,
			defaultOpen,
			flattened,
		);
		model.resetPaths(treePaths, { initialExpandedPaths: expand });
		for (const dir of collapse) {
			if (isDirExpanded(dir))
				(model.getItem(`${dir}/`) as FileTreeDirectoryHandle).collapse();
		}
		shapeRef.current = { treePaths, dirs, chainDirs };
	}, [
		model,
		treePaths,
		dirs,
		chainDirs,
		isDirExpanded,
		flattenEmptyDirectories,
	]);
	const syncingSelectionRef = useRef(false);
	useEffect(() => {
		if (!selectedTreePath || !fileByTreePath.has(selectedTreePath)) return;
		const selected = model.getSelectedPaths();
		if (selected.length === 1 && selected[0] === selectedTreePath) return;
		syncingSelectionRef.current = true;
		try {
			for (const path of selected) model.getItem(path)?.deselect();
			model.getItem(selectedTreePath)?.select();
		} finally {
			syncingSelectionRef.current = false;
		}
	}, [model, selectedTreePath, fileByTreePath]);

	const gitStatusKey = files.map((f) => `${f.path}\0${f.status}`).join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: gitStatusKey serializes path+status so identical poll results do not reset Pierre tree git decorations
	useEffect(() => {
		model.setGitStatus(buildGitStatus(files, toTreePath));
	}, [model, gitStatusKey, toTreePath]);

	useFallthroughIcons(model);

	const lastFoldEpochRef = useRef(foldSignal.epoch);
	useEffect(() => {
		if (foldSignal.epoch === lastFoldEpochRef.current) return;
		lastFoldEpochRef.current = foldSignal.epoch;
		const expand = foldSignal.action === "expand";
		expansionRef.current = { known: new Map(), defaultOpen: expand };
		for (const dir of dirs) {
			const expanded = isDirExpanded(dir);
			if (expanded === undefined || expanded === expand) continue;
			const handle = model.getItem(`${dir}/`) as FileTreeDirectoryHandle;
			if (expand) handle.expand();
			else handle.collapse();
		}
	}, [foldSignal, dirs, model, isDirExpanded]);

	handlersRef.current.onSelect = (treePath) => {
		if (syncingSelectionRef.current) return;
		const file = fileByTreePath.get(treePath);
		if (file) onSelectFile(file);
	};
	handlersRef.current.renderRowDecoration = (ctx) => {
		if (ctx.item.kind === "directory") {
			const count = dirFileCount.get(stripTrailingSlash(ctx.item.path));
			return count ? { text: String(count) } : null;
		}
		const file = fileByTreePath.get(ctx.item.path);
		if (!file) return null;
		return diffStatsDecoration(file.additions, file.deletions);
	};

	return { model, fileByTreePath, toTreePath, toRealPath };
}

function buildGitStatus(
	files: ChangedFileEntry[],
	toTreePath: Map<string, string>,
): PierreGitStatusEntry[] {
	return files.map((file) => ({
		path: toTreePath.get(file.path) ?? file.path,
		status: FILE_STATUS_TO_PIERRE[file.status],
	}));
}
