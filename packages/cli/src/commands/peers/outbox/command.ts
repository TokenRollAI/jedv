import { CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description:
		"Inspect durable remote delivery; acked means host receipt, not recipient acknowledgement",
	options: {
		...networkOptions(),
		peer: string().desc("Peer ID"),
		status: string().desc("pending, inflight, acked or dead"),
	},
	run: async ({ ctx, options }) => {
		if (
			options.status &&
			!["pending", "inflight", "acked", "dead"].includes(options.status)
		)
			throw new CLIError("Unknown outbox status");
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.outbox.query({
				peerId: options.peer,
				status: options.status as
					| "pending"
					| "inflight"
					| "acked"
					| "dead"
					| undefined,
			}),
		};
	},
});
