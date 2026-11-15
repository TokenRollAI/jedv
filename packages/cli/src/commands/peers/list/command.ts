import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "List peer origins and masked credential hints",
	options: { ...networkOptions() },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.list.query(),
		};
	},
});
