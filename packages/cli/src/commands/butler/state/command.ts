import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { butlerOptions, conversationClient } from "../helpers";
export default command({
	description:
		"Read the persistent current conversation; first initialization writes only metadata",
	options: {
		...butlerOptions(),
		preferredThread: string().desc(
			"Existing conversation to prefer only on first initialization",
		),
	},
	run: async ({ ctx, options }) => ({
		data: await (await conversationClient(ctx, options)).butler.state.query({
			preferredThreadId: options.preferredThread,
		}),
	}),
});
