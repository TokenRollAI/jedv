import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Resume automatic mail nudges",
	options: { ...teamworkOptions() },
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.resume.mutate({ ...teamSelection(options) }),
		};
	},
});
