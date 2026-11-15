import { boolean, number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";

export default command({
	description: "Read a terminal's current screen back as text",
	options: {
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host on this machine (default: local)"),
		local: boolean().desc("The workspace is on this machine"),
		terminal: string().required().desc("Terminal ID to read"),
		maxLines: number().int().desc("Cap returned rows from the bottom"),
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

		const result = await target.client.terminal.snapshot.query({
			terminalId: options.terminal,
			workspaceId: options.workspace,
			maxLines: options.maxLines ?? undefined,
		});

		return {
			data: result,
			message: result.text,
		};
	},
});
