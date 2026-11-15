import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Immediately revoke all restricted mobile sessions",
	options: { ...networkOptions() },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "mobileAuth")
			).mobileAuth.revokeAllSessions.mutate(),
		};
	},
});
