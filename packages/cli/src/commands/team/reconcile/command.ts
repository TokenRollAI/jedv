import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description:
		"Reconcile planned resources without creating another terminal or worktree",
	options: { ...teamworkOptions() },
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.reconcile.mutate({ ...teamSelection(options) }),
		};
	},
});
