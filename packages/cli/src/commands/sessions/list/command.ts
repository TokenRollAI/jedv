import { number } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	resolveSessionWorkspace,
	sessionWorkspaceOptions,
} from "../../../lib/sessions";
import { table } from "../../../lib/table";

export default command({
	description: "List chat sessions in a workspace",
	options: {
		...sessionWorkspaceOptions,
		limit: number()
			.int()
			.min(1)
			.max(200)
			.desc("Maximum number of sessions to return (1-200)"),
	},
	display: (data) =>
		table(
			(data ?? []) as unknown as Record<string, unknown>[],
			["sessionId", "harness", "status", "live", "title"],
			["SESSION", "HARNESS", "STATUS", "LIVE", "TITLE"],
		),
	run: async ({ ctx, options }) => {
		const { sessions } = await resolveSessionWorkspace(ctx, options);

		const result = await sessions.list.query({
			workspaceId: options.workspace,
			limit: options.limit,
		});

		return {
			data: result,
			message: `${result.length} session(s) in workspace ${options.workspace}`,
		};
	},
});
