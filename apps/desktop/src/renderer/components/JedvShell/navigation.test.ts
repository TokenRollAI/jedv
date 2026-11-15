import { expect, test } from "bun:test";
import { useHotkeyOverridesStore } from "renderer/hotkeys/stores/hotkeyOverridesStore";
import {
	hotkeyAction,
	resolveJedvHotkey,
} from "./hooks/useJedvHotkeys/useJedvHotkeys";
import { parseNavigation } from "./hooks/useJedvNavigation/useJedvNavigation";
import { groupProjects } from "./project-tree";
import type { Project, Workspace } from "./types";

test("restored navigation is bounded and ignores credentials or corrupt storage", () => {
	const state = parseNavigation(
		JSON.stringify({
			workspaceId: "workspace",
			terminalId: "terminal",
			collapsedProjects: Array.from({ length: 100 }, (_, i) => String(i)),
			secret: "never persist",
			baseUrl: "https://host.ts.net",
		}),
	);
	expect(state.collapsedProjects).toHaveLength(64);
	expect(state.hostUrl).toBeNull();
	expect("secret" in state).toBe(false);
	expect("baseUrl" in state).toBe(false);
	expect(state.workspaceSortMode).toBe("manual");
	expect(parseNavigation("broken").workspaceId).toBeNull();
});
test("terminal ordinary keys and modified escape sequences stay out of app shortcuts", () => {
	const key = {
		key: "t",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
	};
	expect(hotkeyAction(key)).toBeNull();
	expect(hotkeyAction({ ...key, ctrlKey: true, altKey: true })).toBeNull();
	expect(hotkeyAction({ ...key, metaKey: true })).toBe("t");
	expect(
		hotkeyAction({ ...key, key: "H", metaKey: true, shiftKey: true }),
	).toBe("host");
});
test("macOS Control chords reach the terminal while Command and other platforms retain app shortcuts", () => {
	for (const key of ["b", "t", "w"]) {
		const event = {
			key,
			ctrlKey: true,
			metaKey: false,
			altKey: false,
			shiftKey: false,
		};
		expect(hotkeyAction(event, true)).toBeNull();
		expect(hotkeyAction(event, false)).toBe(key);
		expect(
			hotkeyAction({ ...event, ctrlKey: false, metaKey: true }, true),
		).toBe(key);
	}
});
test("project tree keeps workspace ownership while filtering across two projects", () => {
	const projects = [
		{ id: "a", name: "Alpha" },
		{ id: "b", name: "Beta" },
	] as Project[];
	const workspaces = [
		{ id: "wa", projectId: "a", name: "Feature", branch: "feature" },
		{ id: "wb", projectId: "b", name: "Other", branch: "main" },
	] as Workspace[];
	const groups = groupProjects(projects, workspaces, "Feature");
	expect(groups.map((group) => group.project.id)).toEqual(["a"]);
	expect(groups[0].workspaces.map((workspace) => workspace.id)).toEqual(["wa"]);
	expect(groupProjects(projects, workspaces, "")[1].workspaces[0].id).toBe(
		"wb",
	);
});

test("registered hotkey override reaches the Shell and explicit unassignment releases the old binding", () => {
	const old = useHotkeyOverridesStore.getState().overrides;
	try {
		useHotkeyOverridesStore.getState().setOverride("NEW_GROUP", "meta+alt+y");
		expect(
			resolveJedvHotkey(
				{
					type: "keydown",
					key: "y",
					code: "KeyY",
					metaKey: true,
					altKey: true,
				} as KeyboardEvent,
				true,
			),
		).toBe("t");
		expect(
			resolveJedvHotkey(
				{
					type: "keydown",
					key: "t",
					code: "KeyT",
					metaKey: true,
				} as KeyboardEvent,
				true,
			),
		).not.toBe("t");
		useHotkeyOverridesStore.getState().setOverride("NEW_GROUP", null);
		expect(
			resolveJedvHotkey(
				{
					type: "keydown",
					key: "y",
					code: "KeyY",
					metaKey: true,
					altKey: true,
				} as KeyboardEvent,
				true,
			),
		).toBeNull();
	} finally {
		useHotkeyOverridesStore.setState({ overrides: old });
	}
});
