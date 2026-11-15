import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "List restricted mobile sessions without credentials",
	options: { ...networkOptions() },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "mobileAuth")
			).mobileAuth.listSessions.query(),
		};
	},
});
