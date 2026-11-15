import { boolean, CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";

export default command({
	description:
		"Read an agent's own transcript, beyond the screen `terminals read` returns",
	options: {
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host on this machine (default: local)"),
		local: boolean().desc("The workspace is on this machine"),
		terminal: string()
			.required()
			.desc(
				"Terminal ID the agent runs in (the sessionId `agents create` returned)",
			),
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

		const transcript = await target.client.terminalAgents.transcript.query({
			workspaceId: options.workspace,
			terminalId: options.terminal,
		});

		if (!transcript) {
			throw new CLIError(
				"No transcript for that terminal",
				"Its agent either keeps none where Jedv can read it, or the terminal is not an agent's",
			);
		}

		return { data: transcript, message: transcript.text };
	},
});
