import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Remove a peer and its pending outbox records",
	options: { ...networkOptions(), peer: string().required().desc("Peer ID") },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.remove.mutate({ peerId: options.peer }),
		};
	},
});
