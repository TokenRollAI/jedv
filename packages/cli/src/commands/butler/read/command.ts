import { CLIError, positional } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { attentionClient, butlerOptions } from "../helpers";
export default command({
	description:
		"Mark an attention group or alert read without acknowledging Mail or resolving its cause",
	args: [
		positional("target").required().desc("Attention group key or alert ID"),
	],
	options: { ...butlerOptions() },
	run: async ({ ctx, options, args }) => {
		if (!args.target) throw new CLIError("Missing attention group or alert ID");
		const client = await attentionClient(ctx, options);
		return {
			data: await client.butler.markAttentionRead.mutate(
				args.target.includes(":")
					? { groupKey: args.target }
					: { alertId: args.target },
			),
		};
	},
});
