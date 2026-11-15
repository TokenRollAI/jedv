import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Pause automatic mail nudges without stopping any terminal",
	options: { ...teamworkOptions() },
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.pause.mutate({ ...teamSelection(options) }),
		};
	},
});
