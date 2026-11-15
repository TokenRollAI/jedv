import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import type { FolderLinkAction } from "../../link-policy/types";
import type { ModifierEvent } from "../types";
export function folderIntentFor(
	event: ModifierEvent,
): "external" | "reveal" | null {
	if (!event.metaKey && !event.ctrlKey) return null;
	return event.shiftKey ? "external" : "reveal";
}

export function folderIntentLabel(intent: FolderLinkAction) {
	const labels = {
		reveal: msg({ message: "Reveal in sidebar" }),
		external: msg({ message: "Open in editor" }),
		finder: msg({ message: "Open in Finder" }),
	};
	return i18n._(labels[intent]);
}
