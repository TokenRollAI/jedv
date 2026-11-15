import { boolean, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";

export default command({
	description: "List the live terminal sessions in a workspace",
	options: {
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host on this machine (default: local)"),
		local: boolean().desc("The workspace is on this machine"),
	},
	run: async ({ ctx, options }) => {
		const organizationId = ctx.config.organizationId;

		const { target } = await resolveWorkspaceTarget(
			{
				organizationId,

				host: options.host ?? undefined,
				local: options.local ?? undefined,
			},
			options.workspace,
		);

		const result = await target.client.terminal.list.query({
			workspaceId: options.workspace,
		});

		return {
			data: result,
			message: `${result.sessions.length} terminal(s) in workspace ${options.workspace}`,
		};
	},
});
