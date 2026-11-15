import { CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { attentionClient, butlerOptions } from "../helpers";
export default command({
	description:
		"Ignore an attention group or alert with an audit reason; never resolves its underlying cause",
	args: [
		positional("target").required().desc("Attention group key or alert ID"),
	],
	options: {
		...butlerOptions(),
		reason: string().desc("Optional ignore reason"),
	},
	run: async ({ ctx, options, args }) => {
		if (!args.target) throw new CLIError("Missing attention group or alert ID");
		const client = await attentionClient(ctx, options);
		return {
			data: await client.butler.ignoreAttention.mutate({
				...(args.target.includes(":")
					? { groupKey: args.target }
					: { alertId: args.target }),
				reason: options.reason,
			}),
		};
	},
});
