import { number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { attentionClient, butlerOptions } from "../helpers";
export default command({
	description:
		"Read WatchDog alerts and pending approvals; never calls write tools",
	options: {
		...butlerOptions(),
		view: string()
			.enum("open", "handled", "all")
			.default("open")
			.desc("Attention disposition"),
		limit: number()
			.int()
			.min(1)
			.max(500)
			.default(100)
			.desc("Maximum attention groups; badge always counts the full database"),
	},
	run: async ({ ctx, options }) => ({
		data: await (await attentionClient(ctx, options)).butler.attention.query({
			view: options.view,
			limit: options.limit,
		}),
	}),
});
