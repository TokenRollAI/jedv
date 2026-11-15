import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { teamworkClient, teamworkOptions } from "../../../lib/teamwork";
export default command({
	description: "List local Teams",
	options: {
		...teamworkOptions(),
		status: string()
			.enum("active", "all")
			.default("active")
			.desc("Include active/paused Teams, or all Teams"),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return { data: await client.team.list.query({ status: options.status }) };
	},
});
