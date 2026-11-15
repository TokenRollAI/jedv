import { describe, expect, test } from "bun:test";
import type { LinkHoverInfo } from "renderer/lib/terminal/terminal-runtime-registry";
import { DEFAULT_LINK_SETTINGS } from "../JedvFilesView/utils/link-policy/settings";
import {
	openTerminalLink,
	resolveTerminalLinkAction,
	type TerminalLinkHandlers,
} from "./link-actions";

const file: LinkHoverInfo = {
	kind: "file",
	resolvedPath: "/workspace/example.ts",
	isDirectory: false,
	row: 9,
	col: 3,
};
const folder: LinkHoverInfo = {
	kind: "file",
	resolvedPath: "/workspace/src",
	isDirectory: true,
};
const url: LinkHoverInfo = { kind: "url", url: "https://example.com/path" };
const events = [
	{ ctrlKey: false, metaKey: false, shiftKey: false },
	{ ctrlKey: false, metaKey: false, shiftKey: true },
	{ ctrlKey: true, metaKey: false, shiftKey: false },
	{ ctrlKey: false, metaKey: true, shiftKey: true },
] as const;
function fixture(remote = false) {
	const calls: unknown[][] = [];
	const handlers: TerminalLinkHandlers = {
		remote,
		onOpenFile: (...args) => {
			calls.push(["file", ...args]);
		},
		onOpenUrl: (...args) => {
			calls.push(["url", ...args]);
		},
		openEditor: async (...args) => {
			calls.push(["editor", ...args]);
		},
		openFinder: async (...args) => {
			calls.push(["finder", ...args]);
		},
		openExternalUrl: async (...args) => {
			calls.push(["external", ...args]);
		},
	};
	return { handlers, calls };
}

describe("terminal link policy", () => {
	test("uses the four configured tiers for URL, file and folder, including Ctrl", () => {
		const settings = {
			...DEFAULT_LINK_SETTINGS,
			fileLinks: {
				plain: "pane",
				shift: "newTab",
				meta: null,
				metaShift: "external",
			} as const,
		};
		expect(
			events.map((event) =>
				resolveTerminalLinkAction(url, settings, event, false),
			),
		).toEqual(["external", "external", "external", "external"]);
		expect(
			events.map((event) =>
				resolveTerminalLinkAction(file, settings, event, false),
			),
		).toEqual(["pane", "newTab", null, "external"]);
		expect(
			events.map((event) =>
				resolveTerminalLinkAction(folder, settings, event, false),
			),
		).toEqual([null, "finder", "reveal", "external"]);
	});
	test("normalizes legacy URL placements to the system browser and pinned file opening without target fallback", async () => {
		const { handlers, calls } = fixture();
		await openTerminalLink(url, "rightPane", handlers);
		await openTerminalLink(url, "external", handlers);
		await openTerminalLink(file, "pane", handlers);
		await openTerminalLink(file, "newTab", handlers);
		await openTerminalLink(folder, "reveal", handlers);
		expect(calls).toEqual([
			["url", url.url, "external"],
			["url", url.url, "external"],
			["file", file.resolvedPath, false],
			["file", file.resolvedPath, true],
			["file", folder.resolvedPath, false],
		]);
	});
	test("local editor preserves resolved path and location; Finder is a real separate target", async () => {
		const { handlers, calls } = fixture();
		await openTerminalLink(file, "external", handlers);
		await openTerminalLink(folder, "finder", handlers);
		expect(calls).toEqual([
			["editor", file.resolvedPath, 9, 3],
			["finder", folder.resolvedPath],
		]);
	});
	test("remote blocks local path actions even when invoked directly but permits host file viewing", async () => {
		const { handlers, calls } = fixture(true);
		expect(
			resolveTerminalLinkAction(file, DEFAULT_LINK_SETTINGS, events[3], true),
		).toBeNull();
		expect(await openTerminalLink(file, "external", handlers)).toBe(false);
		expect(await openTerminalLink(folder, "finder", handlers)).toBe(false);
		expect(
			await openTerminalLink(
				{ kind: "url", url: "file:///tmp/private" },
				"external",
				handlers,
			),
		).toBe(false);
		await openTerminalLink(file, "pane", handlers);
		await openTerminalLink(folder, "reveal", handlers);
		expect(calls).toEqual([
			["file", file.resolvedPath, false],
			["file", folder.resolvedPath, false],
		]);
	});
	test("missing consumers and failed explicit targets never become a different action", async () => {
		const { handlers, calls } = fixture();
		const withoutBrowser = { ...handlers, onOpenUrl: undefined };
		expect(await openTerminalLink(url, "pane", withoutBrowser)).toBe(false);
		await openTerminalLink(url, "external", withoutBrowser);
		expect(calls).toEqual([["external", url.url]]);
		const failure = new Error("editor unavailable");
		await expect(
			openTerminalLink(file, "external", {
				...handlers,
				openEditor: async () => {
					throw failure;
				},
			}),
		).rejects.toThrow(failure);
		expect(calls).toHaveLength(1);
	});
});
