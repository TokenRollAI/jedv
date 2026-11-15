import { boolean, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveHostTarget } from "../../../lib/host-target";
import { resolveWorkspaceHost } from "../../../lib/host-workspaces";
import { archiveOnHost, reportHostOutcomes } from "./archiveOnHost";

export default command({
	description:
		"Archive local workspaces by ID. A worktree folder may be removed; its branch remains.",
	aliases: ["delete"],
	args: [positional("ids").required().variadic().desc("Workspace IDs")],
	options: {
		host: string().desc("Host on this machine"),
		local: boolean().desc("The workspaces are on this machine"),
	},
	run: async ({ ctx, args, options }) => {
		const ids = args.ids as string[];
		const organizationId = ctx.config.organizationId;

		const hostId = await resolveWorkspaceHost({
			host: options.host,
			local: options.local,
		});
		const target = await resolveHostTarget({
			requestedHostId: hostId,
			organizationId,
		});

		return reportHostOutcomes(
			await archiveOnHost(target.client, ids),
			target.hostId,
		);
	},
});
