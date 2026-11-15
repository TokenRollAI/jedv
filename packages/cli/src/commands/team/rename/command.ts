import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Rename a Team",
	options: {
		...teamworkOptions(),
		name: string().required().desc("New Team name"),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.rename.mutate({
				...teamSelection(options),
				name: options.name,
			}),
		};
	},
});
