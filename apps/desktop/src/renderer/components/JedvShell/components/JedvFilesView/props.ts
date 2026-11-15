import type { JedvParityViewContext } from "../../parity-types";

export interface JedvFilesViewProps {
	context: JedvParityViewContext;
	workspaceId: string;
	/** Workspace-relative or absolute path, resolved against workspace.worktreePath. */
	initialPath?: string;
	initialPinned?: boolean;
	initialRequestId?: number;
	getWsToken: () => string | null;
	active?: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	onOpenUrl?: (
		url: string,
		placement?: "new-tab" | "split-pane",
	) => void | Promise<void>;
}
