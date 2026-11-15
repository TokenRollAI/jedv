import { CLIError, positional } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { memoryOptions, memoryTarget } from "../helpers";
export default command({
	description: "Retire a memory entry and preserve its history",
	args: [positional("id").required().desc("Memory ID")],
	options: { ...memoryOptions() },
	run: async ({ ctx, options, args }) => {
		if (!args.id) throw new CLIError("Missing memory ID");
		const target = await memoryTarget(ctx, options);
		return { data: await target.client.memory.remove.mutate({ id: args.id }) };
	},
});
