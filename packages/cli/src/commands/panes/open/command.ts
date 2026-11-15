import { boolean, CLIError, number, positional } from "@jedv/cli-framework";

const SIDEBAR_TOOLS = ["changes", "file", "files"] as const;

import { command } from "../../../lib/command";
import { resolveHostClient } from "../../../lib/resolve-host-client";
import { callPanes, layoutResult, workspaceOptions } from "../shared";

export default command({
	description:
		"Open Changes, a file, or Files in the right sidebar and show it. Reuses its tab if one is open",
	args: [
		positional("what")
			.required()
			.enum(...SIDEBAR_TOOLS)
			.desc("changes, file, or files"),
		positional("path").desc(
			"File to show: in the editor for `file`, or its diff for `changes`",
		),
	],
	options: {
		...workspaceOptions,
		line: number().int().min(1).desc("Line to scroll to in the file"),
		background: boolean().desc(
			"Add the tab without showing the sidebar or changing its active tab",
		),
	},
	run: async ({ ctx, args, options }) => {
		const tool = args.what as (typeof SIDEBAR_TOOLS)[number];
		const path = (args.path as string | undefined) ?? undefined;
		const { line } = options;
		if (tool === "file" && !path) {
			throw new CLIError(
				"Say which file to open",
				"jedv panes open file src/app.ts",
			);
		}
		if (path && tool !== "file" && tool !== "changes") {
			throw new CLIError(
				"A path only applies to `open file` and `open changes`",
			);
		}
		if (line && !path) {
			throw new CLIError("--line needs a file path");
		}
		const client = await resolveHostClient(ctx, options);
		const result = await callPanes(() =>
			client.panes.open.mutate({
				workspaceId: options.workspace,
				tool,
				path,
				line: line ?? undefined,
				...(options.background ? { background: true } : {}),
			}),
		);
		return layoutResult(
			`Sidebar ${tool}${path ? ` ${path}` : ""}: pane ${result.paneId} in tab ${result.tabId}`,
			result,
		);
	},
});
