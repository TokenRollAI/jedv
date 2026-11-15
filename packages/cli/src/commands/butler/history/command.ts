import { number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { butlerClient, butlerOptions, conversationClient } from "../helpers";
export default command({
	description: "Read saved human, tool and assistant messages",
	options: {
		...butlerOptions(),
		thread: string().desc(
			"Thread ID (default: persistent current conversation)",
		),
		limit: number().int().min(1).max(200).default(100).desc("Maximum messages"),
		beforeId: string().desc("Read messages before this message ID"),
	},
	run: async ({ ctx, options }) => ({
		data: await (
			await (options.thread
				? butlerClient(ctx, options)
				: conversationClient(ctx, options))
		).butler.history.query({
			threadId: options.thread,
			limit: options.limit,
			beforeId: options.beforeId,
		}),
	}),
});
