import { webContents } from "electron";
import { getFocusedOrLastWindow } from "../window-registry/window-registry";
import { PaneLayoutRequests } from "./request-dispatcher";

export type {
	PaneLayoutRendererRequest,
	PaneLayoutReply,
	RendererPaneLayoutOp,
} from "./request-dispatcher";
export { PaneLayoutRequestError } from "./request-dispatcher";
export const paneLayoutRequests = new PaneLayoutRequests({
	focusedWindowId: () => {
		const window = getFocusedOrLastWindow();
		return window && !window.isDestroyed() ? window.webContents.id : null;
	},
	isAlive: (id) => {
		const contents = webContents.fromId(id);
		return !!contents && !contents.isDestroyed();
	},
});
