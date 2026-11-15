import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useSettings } from "renderer/stores/settings";
import { useSidebarFilePolicy } from "../clickPolicy/policies/policy";
import {
	useFileLinkAction,
	useFolderLinkAction,
	useUrlLinkAction,
} from "./hooks";

test("saved link settings immediately reach Markdown and tree consumers without retaining clicked URLs", () => {
	const original = useSettings.getState();
	const saved = localStorage.getItem("settings");
	const view = renderHook(() => ({
		url: useUrlLinkAction("4-tier"),
		inline: useUrlLinkAction("2-tier"),
		file: useFileLinkAction("4-tier", { remote: false }),
		folder: useFolderLinkAction({ remote: false }),
		tree: useSidebarFilePolicy(false),
	}));
	const plain = { metaKey: false, ctrlKey: false, shiftKey: false };
	try {
		act(() => {
			useSettings.getState().update("urlLinks", {
				plain: "rightPane",
				shift: "newTab",
				meta: "pane",
				metaShift: "external",
			});
			useSettings.getState().update("fileLinks", {
				plain: "newTab",
				shift: null,
				meta: "pane",
				metaShift: "external",
			});
			useSettings.getState().update("sidebarFileLinks", {
				plain: "external",
				shift: "newTab",
				meta: "pane",
				metaShift: "external",
			});
			useSettings.getState().update("folderLinks", {
				plain: "reveal",
				shift: "finder",
				meta: "reveal",
				metaShift: "external",
			});
		});
		expect(
			view.result.current.url(plain, "https://example.com/?secret=not-stored"),
		).toBe("external");
		expect(view.result.current.inline(plain, "https://example.com")).toBe(
			"external",
		);
		expect(view.result.current.file(plain)).toBe("newTab");
		expect(view.result.current.folder(plain)).toBe("reveal");
		expect(view.result.current.tree.getAction(plain)).toBe("external");
		expect(localStorage.getItem("settings")).not.toContain("not-stored");
	} finally {
		view.unmount();
		useSettings.setState(original, true);
		if (saved === null) localStorage.removeItem("settings");
		else localStorage.setItem("settings", saved);
	}
});
