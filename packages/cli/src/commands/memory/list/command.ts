import { boolean, number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { memoryOptions, memoryScope, memoryTarget } from "../helpers";
export default command({
	description: "List active memory, candidates or retained history",
	options: {
		...memoryOptions(),
		tier: string().enum("core", "archival").desc("Tier filter"),
		candidates: boolean().desc("Include proposed candidates"),
		history: boolean().desc("Include rejected, removed and superseded history"),
		limit: number().int().min(1).max(500).default(100).desc("Maximum entries"),
	},
	run: async ({ ctx, options }) => {
		const target = await memoryTarget(ctx, options);
		return {
			data: await target.client.memory.list.query({
				...(await memoryScope(options, target)),
				tier: options.tier,
				includeCandidates: options.candidates,
				includeHistory: options.history,
				limit: options.limit,
			}),
		};
	},
});
