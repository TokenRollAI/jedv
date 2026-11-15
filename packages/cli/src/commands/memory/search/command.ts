import { CLIError, number, positional } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { memoryOptions, memoryScope, memoryTarget } from "../helpers";
export default command({
	description: "Search Chinese and English memory with FTS5",
	args: [positional("query").required().desc("Search terms")],
	options: {
		...memoryOptions(),
		limit: number().int().min(1).max(100).default(10).desc("Maximum entries"),
	},
	run: async ({ ctx, options, args }) => {
		if (!args.query) throw new CLIError("Missing query");
		const target = await memoryTarget(ctx, options);
		return {
			data: await target.client.memory.search.query({
				...(await memoryScope(options, target)),
				query: args.query,
				limit: options.limit,
			}),
		};
	},
});
