import { boolean, CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	resolveWorkspaceHost,
	resolveWorkspaceTarget,
} from "../../../lib/host-workspaces";
import { openUrl, workspaceLinks } from "../../../lib/open-url";

export default command({
	description: "Open a workspace in the Jedv desktop app",
	args: [positional("id").required().desc("Workspace ID")],
	options: {
		host: string().desc("Host on this machine (default: local)"),
		local: boolean().desc("The workspace is on this machine"),
		print: boolean().desc(
			"Print the deep link URL instead of opening the desktop app",
		),
	},
	run: async ({ ctx, args, options }) => {
		const id = args.id as string;
		const organizationId = ctx.config.organizationId;

		const hostId = await resolveWorkspaceHost({
			host: options.host,
			local: options.local,
		});
		const { workspace } = await resolveWorkspaceTarget(
			{ organizationId, host: hostId },
			id,
		);

		const { url } = workspaceLinks(workspace.id);

		if (!options.print) {
			try {
				await openUrl(url);
			} catch (err) {
				throw new CLIError(
					"Failed to open desktop app",
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		return {
			data: { id: workspace.id, name: workspace.name, url },
			message: options.print
				? url
				: `Opening "${workspace.name}" in Jedv desktop`,
		};
	},
});
