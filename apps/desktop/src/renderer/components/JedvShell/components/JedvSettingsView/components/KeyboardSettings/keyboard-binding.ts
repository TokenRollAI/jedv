import type { ShortcutBinding } from "renderer/hotkeys/types";
import { parseBinding } from "renderer/hotkeys/utils/binding";
export function isCliControlBinding(
	binding: ShortcutBinding,
	isMac: boolean,
): boolean {
	const keys = parseBinding(binding).chord.split("+");
	return isMac && keys.includes("ctrl") && !keys.includes("meta");
}
