import type { JedvParityViewContext } from "../../parity-types";
import type { DeletedWorkspaceResult } from "../JedvDeleteWorkspaceDialog";
import type { ProjectActionContext } from "../JedvProjectActions";
export interface JedvWorkspacesBoardProps extends JedvParityViewContext {
	getHasUnsavedFiles?(
		context: ProjectActionContext,
		workspaceId: string,
	): boolean;
	onWorkspaceDeleted?(result: DeletedWorkspaceResult): Promise<void> | void;
	onOpenWorkspaceInContext?(result: {
		context: ProjectActionContext;
		workspaceId: string;
	}): Promise<void>;
}
