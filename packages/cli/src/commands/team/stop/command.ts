import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Stop workers while preserving the human leader terminal",
	options: {
		...teamworkOptions(),
		member: string().desc(
			"Worker name or ID; omit to stop all workers and unbind the leader",
		),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.stop.mutate({
				...teamSelection(options),
				member: options.member,
			}),
		};
	},
});
