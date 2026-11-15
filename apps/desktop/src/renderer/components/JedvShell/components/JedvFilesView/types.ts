import type { SharedFileDocument } from "./state/fileDocumentStore/types";
import type { LinkAction } from "./utils/link-policy";
export interface FilePosition {
	line: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
}
export interface ViewProps {
	document: SharedFileDocument;
	filePath: string;
	workspaceId: string;
	paneId: string;
	isActive: boolean;
	pendingPosition?: FilePosition;
	onPositionRevealed?: () => void;
	showFrontMatterNote?: boolean;
	embedded?: boolean;
	onOpenUrl?: (url: string, action: LinkAction) => void;
}
