import {
	clearWorkspaceReadReceipt,
	markWorkspaceRead,
	markWorkspaceUnread,
} from "../../../JedvWorkspacesBoard/stores/read-receipts";
export function markTreeWorkspaceUnread(hostUrl: string, workspaceId: string) {
	markWorkspaceUnread(hostUrl, workspaceId);
}
export function markTreeWorkspaceRead(
	hostUrl: string,
	workspaceId: string,
	lastEvent: number,
) {
	if (lastEvent > 0) markWorkspaceRead(hostUrl, workspaceId, lastEvent);
	else clearWorkspaceReadReceipt(hostUrl, workspaceId);
}
