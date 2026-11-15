import { expect, test } from "bun:test";
import { markdownFileTarget } from "./markdown-target";
import {
	resolveFileLinkAction,
	resolveFolderLinkAction,
	resolveUrlLinkAction,
} from "./resolve";
import { DEFAULT_LINK_SETTINGS, healLinkSettings } from "./settings";
import type { LinkTierMap } from "./types";

const event = { metaKey: false, ctrlKey: false, shiftKey: false };
const map: LinkTierMap = {
	plain: "pane",
	shift: "newTab",
	meta: "rightPane",
	metaShift: "external",
};
test("Markdown URL policies send every enabled tier to the system browser", () => {
	expect(resolveUrlLinkAction(map, event, "4-tier")).toBe("external");
	expect(
		resolveUrlLinkAction(map, { ...event, shiftKey: true }, "4-tier"),
	).toBe("external");
	expect(resolveUrlLinkAction(map, { ...event, metaKey: true }, "4-tier")).toBe(
		"external",
	);
	expect(
		resolveUrlLinkAction(
			map,
			{ ...event, ctrlKey: true, shiftKey: true },
			"4-tier",
		),
	).toBe("external");
	expect(
		resolveUrlLinkAction(map, { ...event, shiftKey: true }, "2-tier"),
	).toBe("external");
	expect(
		resolveUrlLinkAction(
			map,
			{ ...event, ctrlKey: true, shiftKey: true },
			"2-tier",
		),
	).toBe("external");
	expect(
		resolveUrlLinkAction({ ...map, plain: null }, event, "2-tier"),
	).toBeNull();
});
test("remote file and folder policies never dispatch local editor or Finder actions", () => {
	const cmdShift = { ...event, metaKey: true, shiftKey: true };
	expect(
		resolveFileLinkAction(
			DEFAULT_LINK_SETTINGS.sidebarFileLinks,
			cmdShift,
			"4-tier",
			true,
		),
	).toBeNull();
	expect(
		resolveFileLinkAction(
			DEFAULT_LINK_SETTINGS.sidebarFileLinks,
			cmdShift,
			"4-tier",
			false,
		),
	).toBe("external");
	expect(
		resolveFolderLinkAction(
			DEFAULT_LINK_SETTINGS.folderLinks,
			{ ...event, shiftKey: true },
			true,
		),
	).toBeNull();
	expect(
		resolveFolderLinkAction(DEFAULT_LINK_SETTINGS.folderLinks, cmdShift, true),
	).toBeNull();
	expect(
		resolveFolderLinkAction(
			DEFAULT_LINK_SETTINGS.folderLinks,
			{ ...event, metaKey: true },
			true,
		),
	).toBe("reveal");
});
test("link settings hydrate only four finite tier maps and reject unknown actions", () => {
	const healed = healLinkSettings({
		urlLinks: { ...map, extra: "secret" },
		fileLinks: { plain: "rightPane", shift: "javascript:bad" },
		folderLinks: { plain: "arbitrary" },
		unbounded: { workspace: "payload" },
	});
	expect(Object.keys(healed)).toEqual([
		"urlLinks",
		"fileLinks",
		"sidebarFileLinks",
		"folderLinks",
	]);
	expect(Object.keys(healed.urlLinks)).toEqual([
		"plain",
		"shift",
		"meta",
		"metaShift",
	]);
	expect(healed.fileLinks).toEqual(DEFAULT_LINK_SETTINGS.fileLinks);
	expect(healed.folderLinks).toEqual(DEFAULT_LINK_SETTINGS.folderLinks);
});
test("Markdown file targets resolve at the document directory while rejecting outside paths and foreign file hosts", () => {
	const root = "/repo",
		document = "/repo/docs/guide.md";
	expect(markdownFileTarget(root, document, "../src/file.ts")).toBe(
		"/repo/src/file.ts",
	);
	expect(
		markdownFileTarget(root, document, "folder%20name/readme.md#section"),
	).toBe("/repo/docs/folder name/readme.md");
	for (const href of [
		"../../outside",
		"file://other-host/repo/a",
		"https://example.com",
		"javascript:alert(1)",
		"#section",
		"/repo-other/a",
	])
		expect(markdownFileTarget(root, document, href)).toBeNull();
	expect(
		markdownFileTarget("C:\\repo", "C:\\repo\\docs\\readme.md", "../src/a.ts"),
	).toBe("C:/repo/src/a.ts");
});
