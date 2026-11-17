import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@jedv/panes";
import { htmlPreviewUrl } from "@jedv/shared/html-preview";
import {
	decodeWorkspaceLayout,
	encodeWorkspaceLayout,
	type PersistedPaneData,
	WORKSPACE_LAYOUT_BYTES,
} from "./jedv-workspace-layout";

test("layout codec removes legacy browser panes and preserves terminal identity, while rejecting limits and broken trees", () => {
	const store = createWorkspaceStore<PersistedPaneData>();
	store.getState().addTab({
		id: "tab",
		panes: [
			{
				id: "terminal",
				kind: "terminal",
				data: { terminalId: "native-terminal" },
				pinned: true,
			},
			{
				id: "preview",
				kind: "browser",
				data: { url: htmlPreviewUrl("<h1>private draft</h1>") },
				titleOverride: "Private title",
			},
		],
		titleOverride: "Preview title",
	});
	const layout = encodeWorkspaceLayout(store.getState(), ["parked"]);
	expect(layout.tabs[0]?.layout).toEqual({ type: "pane", paneId: "terminal" });
	expect(layout.tabs[0]?.panes.preview).toBeUndefined();
	expect(JSON.stringify(layout)).not.toContain("private");
	expect(layout.tabs[0]?.titleOverride).toBeUndefined();
	expect(decodeWorkspaceLayout(layout)).toEqual(layout);
	expect(() =>
		decodeWorkspaceLayout({
			...layout,
			detachedTerminalIds: Array.from({ length: 257 }, (_, i) => String(i)),
		}),
	).toThrow();
	expect(() =>
		decodeWorkspaceLayout({
			...layout,
			tabs: Array.from({ length: 33 }, () => layout.tabs[0]),
		}),
	).toThrow();
	const broken = structuredClone(layout);
	if (broken.tabs[0])
		broken.tabs[0].layout = { type: "pane", paneId: "missing" };
	expect(() => decodeWorkspaceLayout(broken)).toThrow();
	expect(() =>
		decodeWorkspaceLayout({
			...layout,
			extra: "x".repeat(WORKSPACE_LAYOUT_BYTES),
		}),
	).toThrow("512 KiB");
	const wrongKind = structuredClone(layout);
	if (wrongKind.tabs[0]?.panes.terminal)
		wrongKind.tabs[0].panes.terminal.kind = "changes";
	expect(() => decodeWorkspaceLayout(wrongKind)).toThrow();
});

test("layout codec round-trips chat panes and preserves backwards compatibility", () => {
	const store = createWorkspaceStore<PersistedPaneData>();
	store.getState().addTab({
		id: "chat-tab",
		panes: [
			{
				id: "chat-pane",
				kind: "chat",
				data: { chatSessionId: "chat-1", title: "Fix login flow" },
				pinned: true,
			},
		],
	});
	const layout = encodeWorkspaceLayout(store.getState(), [], ["closed-chat"]);
	expect(layout.tabs[0]?.panes["chat-pane"]?.kind).toBe("chat");
	expect(layout.tabs[0]?.panes["chat-pane"]?.data).toEqual({
		chatSessionId: "chat-1",
		title: "Fix login flow",
	});
	expect(layout.detachedChatSessionIds).toEqual(["closed-chat"]);
	expect(decodeWorkspaceLayout(layout)).toEqual(layout);
	const legacy = decodeWorkspaceLayout({
		version: 1,
		tabs: [],
		activeTabId: null,
		detachedTerminalIds: ["old-term"],
	});
	expect(legacy.detachedChatSessionIds).toBeUndefined();
	expect(() =>
		decodeWorkspaceLayout({
			...layout,
			detachedChatSessionIds: ["chat-1"],
		}),
	).toThrow("Attached chat session cannot be detached");
});
