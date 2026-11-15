import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "List masked, narrowly scoped provider credentials",
	options: { ...networkOptions() },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.listProviderTokens.query(),
		};
	},
});
