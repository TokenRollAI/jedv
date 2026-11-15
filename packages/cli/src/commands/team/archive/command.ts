import { boolean } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Archive a stopped Team without deleting its workspaces",
	options: {
		...teamworkOptions(),
		stop: boolean().desc(
			"Stop workers before archiving; preserve the leader terminal",
		),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.archive.mutate({
				...teamSelection(options),
				stop: options.stop ?? false,
			}),
		};
	},
});
