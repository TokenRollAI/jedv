import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Show a Team, live member bindings and delivery eligibility",
	options: { ...teamworkOptions() },
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.status.query({ ...teamSelection(options) }),
		};
	},
});
