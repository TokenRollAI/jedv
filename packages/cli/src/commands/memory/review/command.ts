import { CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { memoryOptions, memoryTarget } from "../helpers";
export default command({
	description: "Explicitly accept or reject a passive candidate",
	args: [positional("id").required().desc("Candidate ID")],
	options: {
		...memoryOptions(),
		action: string()
			.enum("accept", "reject")
			.required()
			.desc("Review decision"),
		supersede: string().desc(
			"Active entry in the same scope to supersede when accepting",
		),
	},
	run: async ({ ctx, options, args }) => {
		if (!args.id) throw new CLIError("Missing candidate ID");
		const target = await memoryTarget(ctx, options);
		return {
			data: await target.client.memory.reviewCandidate.mutate({
				id: args.id,
				action: options.action,
				supersedeId: options.supersede,
			}),
		};
	},
});
