import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { LinkHoverInfo } from "renderer/lib/terminal/terminal-runtime-registry";
import { DEFAULT_LINK_SETTINGS } from "../../../JedvFilesView/utils/link-policy/settings";
import { createTerminalLinkMenu } from "../../link-menu";
import { terminalContextMenuLinkStore } from "../../links";
import { TerminalLinkHover } from "./TerminalLinkHover";

afterEach(async () => {
	await act(async () => cleanup());
});

test("hover and context actions share configured shortcuts; remote path targets stay disabled", async () => {
	const link: LinkHoverInfo = {
		kind: "file",
		resolvedPath: "/remote/src/index.ts",
		isDirectory: false,
		row: 17,
		col: 2,
	};
	const actions: string[] = [];
	const settings = {
		...DEFAULT_LINK_SETTINGS,
		fileLinks: {
			plain: "newTab",
			shift: null,
			meta: "pane",
			metaShift: "external",
		} as const,
	};
	const handlers = { remote: true, onOpenFile: () => {} };
	const build = (target: LinkHoverInfo) =>
		createTerminalLinkMenu({
			link: target,
			settings,
			handlers,
			onAction: (action) => {
				actions.push(action);
			},
			onOpenIn: () => {
				throw new Error("remote app must stay disabled");
			},
		});
	terminalContextMenuLinkStore.setActions("fixture", build);
	terminalContextMenuLinkStore.record("fixture", link);
	const items = terminalContextMenuLinkStore.getActions("fixture");
	expect(items.find((item) => item.key === "newTab")?.shortcut).toContain(
		"click",
	);
	expect(items.find((item) => item.key === "external")?.disabled).toBe(true);
	expect(
		items
			.find((item) => item.key === "applications")
			?.children?.every((item) => item.disabled),
	).toBe(true);
	const screen = render(
		<TerminalLinkHover
			link={link}
			x={20}
			y={20}
			settings={settings}
			handlers={handlers}
			items={items}
			onAction={(action) => {
				actions.push(action);
			}}
			onCopy={() => {}}
			onEnter={() => {}}
			onLeave={() => {}}
		/>,
	);
	await act(async () => {
		await Promise.resolve();
	});
	expect(screen.getByTitle(link.resolvedPath ?? "").textContent).toContain(
		":17:2",
	);
	const newTab = screen.getByRole("button", { name: /Open in new tab/ });
	fireEvent.click(newTab);
	items.find((item) => item.key === "pane")?.onSelect?.();
	expect(actions).toEqual(["newTab", "pane"]);
	expect(
		screen
			.getAllByRole("button")
			.filter((button) => (button as HTMLButtonElement).disabled),
	).toHaveLength(2);
	terminalContextMenuLinkStore.clear("fixture");
	expect(terminalContextMenuLinkStore.getActions("fixture")).toEqual([]);
});
