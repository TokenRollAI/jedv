import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description:
		"Revoke the old inbound credential and show its replacement once",
	options: { ...networkOptions(), peer: string().required().desc("Peer ID") },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.rotateInbound.mutate({ peerId: options.peer }),
		};
	},
});
