import { boolean, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";

export default command({
	description: "Close (dispose) a terminal running in a workspace",
	options: {
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host on this machine (default: local)"),
		local: boolean().desc("The workspace is on this machine"),
		terminal: string().required().desc("Terminal ID to close"),
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

		const result = await target.client.terminal.killSession.mutate({
			terminalId: options.terminal,
			workspaceId: options.workspace,
		});

		return {
			data: result,
			message: `Closed terminal ${options.terminal}`,
		};
	},
});
