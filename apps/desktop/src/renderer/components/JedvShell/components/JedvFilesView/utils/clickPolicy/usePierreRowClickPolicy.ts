import { useCallback } from "react";
import type { FolderLinkAction, ModifierEvent } from "../link-policy/types";
import { folderIntentFor } from "./policies/folderPolicy";

import type { ClickPolicy } from "./policies/policy";

interface UsePierreRowClickPolicyOptions {
	filePolicy: ClickPolicy;
	getFolderIntent?(event: ModifierEvent): FolderLinkAction | null;
	onRevealFolder?(relativePath: string): void;
	openInFinder?(relativePath: string): void;
	onSelectFile: (relativePath: string, openInNewTab?: boolean) => void;
	onRename: (relativePath: string) => void;
	openInExternalEditor: (relativePath: string) => void;
}

interface UsePierreRowClickPolicyResult {
	onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
	findFileRow: (e: React.MouseEvent) => HTMLElement | null;
}

export function usePierreRowClickPolicy({
	filePolicy,
	getFolderIntent = folderIntentFor,
	onRevealFolder,
	openInFinder,
	onSelectFile,
	onRename,
	openInExternalEditor,
}: UsePierreRowClickPolicyOptions): UsePierreRowClickPolicyResult {
	const findRow = useCallback((e: React.MouseEvent): HTMLElement | null => {
		const path = e.nativeEvent.composedPath();
		for (const node of path) {
			if (!(node instanceof HTMLElement)) continue;
			if (node.getAttribute("data-item-path")) return node;
		}
		return null;
	}, []);

	const findFileRow = useCallback(
		(e: React.MouseEvent): HTMLElement | null => {
			const row = findRow(e);
			const itemPath = row?.getAttribute("data-item-path");
			if (!row || !itemPath || itemPath.endsWith("/")) return null;
			return row;
		},
		[findRow],
	);

	const onClickCapture = useCallback(
		(e: React.MouseEvent<HTMLElement>) => {
			if (
				e.nativeEvent
					.composedPath()
					.some((node) => node instanceof HTMLInputElement)
			)
				return;
			const treePath = findRow(e)?.getAttribute("data-item-path");
			if (!treePath) return;
			const trimmed = treePath.endsWith("/") ? treePath.slice(0, -1) : treePath;
			if (e.detail === 2 && e.button === 0) {
				e.preventDefault();
				e.stopPropagation();
				onRename(treePath);
				return;
			}

			if (treePath.endsWith("/")) {
				const intent = getFolderIntent(e);
				if (intent === null) return;
				e.preventDefault();
				e.stopPropagation();
				if (intent === "external") openInExternalEditor(trimmed);
				else if (intent === "finder") openInFinder?.(trimmed);
				else onRevealFolder?.(trimmed);
				return;
			}

			const { action } = filePolicy.resolve(e);
			if (action === null) return;
			e.preventDefault();
			e.stopPropagation();
			if (action === "external") openInExternalEditor(trimmed);
			else if (action === "newTab") onSelectFile(trimmed, true);
			else if (action === "pane") onSelectFile(trimmed, false);
		},
		[
			filePolicy,
			getFolderIntent,
			onRevealFolder,
			openInFinder,
			onSelectFile,
			onRename,
			openInExternalEditor,
			findRow,
		],
	);

	return { onClickCapture, findFileRow };
}
