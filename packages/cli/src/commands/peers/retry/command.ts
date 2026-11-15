import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description:
		"Explicitly retry a dead outbox item using the same immutable event",
	options: {
		...networkOptions(),
		outbox: string().required().desc("Outbox ID"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.retryDeadOutbox.mutate({ outboxId: options.outbox }),
		};
	},
});
