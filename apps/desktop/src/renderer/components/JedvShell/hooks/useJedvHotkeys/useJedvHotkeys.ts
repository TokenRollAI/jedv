import { useEffect, useRef } from "react";
import type { HotkeyId } from "renderer/hotkeys/registry";
import { useHotkeyOverridesStore } from "renderer/hotkeys/stores/hotkeyOverridesStore";
import { resolveHotkeyFromEvent } from "renderer/hotkeys/utils/resolveHotkeyFromEvent";
export const JEDV_HOTKEY_ACTIONS: Partial<Record<HotkeyId, string>> = {
	QUICK_OPEN: "quick-open",
	OPEN_IN_APP: "open-in-app",
	COPY_PATH: "copy-workspace-path",
	TOGGLE_RIGHT_PANE_FULL_SCREEN: "right-fullscreen",
	CHECK_RESOURCES: "resources",
	NAVIGATE_BACK: "history-back",
	NAVIGATE_FORWARD: "history-forward",
	OPEN_COMMAND_PALETTE: "commands",
	SPLIT_RIGHT: "split-right",
	SPLIT_DOWN: "split-down",
	SPLIT_AUTO: "split-auto",

	FIND_IN_TERMINAL: "find-terminal",
	CLEAR_TERMINAL: "clear-terminal",
	SCROLL_TO_BOTTOM: "scroll-bottom",
	EQUALIZE_PANE_SPLITS: "equalize",
	CLOSE_PANE: "w",
	REOPEN_TAB: "reopen-tab",
	PREV_TAB: "prev-tab",
	PREV_TAB_ALT: "prev-tab",
	NEXT_TAB: "next-tab",
	NEXT_TAB_ALT: "next-tab",
	FOCUS_PANE_LEFT: "focus-left",
	FOCUS_PANE_RIGHT: "focus-right",
	FOCUS_PANE_UP: "focus-up",
	FOCUS_PANE_DOWN: "focus-down",
	ZOOM_IN: "zoom-in",
	ZOOM_OUT: "zoom-out",
	ZOOM_RESET: "zoom-reset",
	RUN_WORKSPACE_COMMAND: "run-workspace",
	TOGGLE_WORKSPACE_SIDEBAR: "b",
	TOGGLE_SIDEBAR: ".",
	OPEN_PRESET_1: "preset-1",
	OPEN_PRESET_2: "preset-2",
	OPEN_PRESET_3: "preset-3",
	OPEN_PRESET_4: "preset-4",
	OPEN_PRESET_5: "preset-5",
	OPEN_PRESET_6: "preset-6",
	OPEN_PRESET_7: "preset-7",
	OPEN_PRESET_8: "preset-8",
	OPEN_PRESET_9: "preset-9",
	OPEN_PROJECT: "o",
	NEW_WORKSPACE: "n",
	NEW_GROUP: "t",

	OPEN_ACTIVE_WORKSPACE_SWITCHER: "active-workspaces",
	OPEN_DIFF_VIEWER: "changes",
	CLOSE_TERMINAL: "w",
	OPEN_SETTINGS: "settings",
	JUMP_TO_WORKSPACE_1: "workspace-1",
	JUMP_TO_WORKSPACE_2: "workspace-2",
	JUMP_TO_WORKSPACE_3: "workspace-3",
	JUMP_TO_WORKSPACE_4: "workspace-4",
	JUMP_TO_WORKSPACE_5: "workspace-5",
	JUMP_TO_WORKSPACE_6: "workspace-6",
	JUMP_TO_WORKSPACE_7: "workspace-7",
	JUMP_TO_WORKSPACE_8: "workspace-8",
	JUMP_TO_WORKSPACE_9: "workspace-9",
	CLOSE_WORKSPACE: "close-workspace",
	UNDO: "undo",
	JUMP_TO_TAB_1: "tab-1",
	JUMP_TO_TAB_2: "tab-2",
	JUMP_TO_TAB_3: "tab-3",
	JUMP_TO_TAB_4: "tab-4",
	JUMP_TO_TAB_5: "tab-5",
	JUMP_TO_TAB_6: "tab-6",
	JUMP_TO_TAB_7: "tab-7",
	JUMP_TO_TAB_8: "tab-8",
	JUMP_TO_TAB_9: "tab-9",
};
export function hotkeyAction(
	event: Pick<
		KeyboardEvent,
		"key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
	>,
	isMac = false,
): string | null {
	if (isMac && event.ctrlKey && !event.metaKey) return null;
	if ((!event.metaKey && !event.ctrlKey) || event.altKey) return null;
	if (event.shiftKey) return event.key.toLowerCase() === "h" ? "host" : null;
	const key = event.key.toLowerCase();
	return [
		"b",
		"o",
		"n",
		"t",
		"w",
		".",
		"1",
		"2",
		"3",
		"4",
		"5",
		"6",
		"7",
		"8",
		"9",
	].includes(key)
		? key
		: null;
}
export function resolveJedvHotkey(
	event: KeyboardEvent,
	isMac: boolean,
): string | null {
	if (event.isComposing || event.getModifierState?.("AltGraph")) return null;
	const registered = resolveHotkeyFromEvent(event);
	const isPresetNumber =
		registered?.startsWith("OPEN_PRESET_") && /^[1-9]$/.test(event.key);
	if (isMac && event.ctrlKey && !event.metaKey && !isPresetNumber) return null;

	if (registered) return JEDV_HOTKEY_ACTIONS[registered] ?? null;
	let action: string | undefined;
	if (!action) {
		const legacy = hotkeyAction(event, isMac);
		if (legacy && /^[1-9]$/.test(legacy)) return null;
		const fallback = legacy;
		const id = Object.entries(JEDV_HOTKEY_ACTIONS).find(
			([, value]) => value === fallback,
		)?.[0];
		if (
			fallback &&
			(!id || !(id in useHotkeyOverridesStore.getState().overrides))
		)
			action = fallback;
	}
	return action ?? null;
}
export function handleJedvHotkey(
	event: KeyboardEvent,
	onAction: (action: string) => void,
	{
		canGoBack,
		isMac,
		overlayOpen,
		terminalActive = true,
	}: {
		canGoBack: boolean;
		isMac: boolean;
		overlayOpen: boolean;
		terminalActive?: boolean;
	},
) {
	if (overlayOpen || event.defaultPrevented || event.isComposing) return;
	const element = event.target as HTMLElement | null;
	const editing = element?.closest?.(
		'input,textarea,[contenteditable="true"],.cm-editor,.xterm',
	);
	const bareEscape =
		event.key === "Escape" &&
		!event.altKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey;
	if (bareEscape && (!canGoBack || editing)) return;
	const action = bareEscape ? "back" : resolveJedvHotkey(event, isMac);
	if (
		!terminalActive &&
		[
			"w",
			"find-terminal",
			"clear-terminal",
			"scroll-bottom",
			"split-auto",
			"split-browser",
			"split-right",
			"split-down",
			"equalize",
			"reopen-tab",
			"prev-tab",
			"next-tab",
			"focus-left",
			"focus-right",
			"focus-up",
			"focus-down",
		].includes(action ?? "")
	)
		return;
	if (
		editing &&
		!element?.closest?.(".xterm") &&
		!["quick-open", "commands", "zoom-in", "zoom-out", "zoom-reset"].includes(
			action ?? "",
		)
	)
		return;
	if (!action) return;
	event.preventDefault();
	event.stopPropagation();
	onAction(action);
}

export function useJedvHotkeys(
	onAction: (action: string) => void,
	{
		canGoBack = false,
		terminalActive = true,
	}: { canGoBack?: boolean; terminalActive?: boolean } = {},
) {
	const ref = useRef({ onAction, canGoBack, terminalActive });
	ref.current = { onAction, canGoBack, terminalActive };
	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			handleJedvHotkey(event, ref.current.onAction, {
				canGoBack: ref.current.canGoBack,
				terminalActive: ref.current.terminalActive,
				isMac: navigator.platform.toLowerCase().includes("mac"),
				overlayOpen: !!document.querySelector(
					'[role="dialog"], [role="alertdialog"], [role="menu"][data-state="open"]',
				),
			});
		};
		document.addEventListener("keydown", listener, true);
		return () => document.removeEventListener("keydown", listener, true);
	}, []);
}
