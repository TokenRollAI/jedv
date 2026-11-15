import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { memoryOptions, memoryScope, memoryTarget } from "../helpers";
export default command({
	description:
		"Write active memory; optionally supersede an old entry in the same scope",
	options: {
		...memoryOptions(),
		content: string().required().desc("Memory content"),
		title: string().desc("Title"),
		tier: string()
			.enum("core", "archival")
			.default("core")
			.desc("Injection tier"),
		category: string()
			.enum("correction", "convention", "pitfall", "context", "summary")
			.default("context")
			.desc("Category"),
		supersede: string().desc("Prior active memory ID"),
	},
	run: async ({ ctx, options }) => {
		const target = await memoryTarget(ctx, options);
		return {
			data: await target.client.memory.put.mutate({
				...(await memoryScope(options, target)),
				content: options.content,
				title: options.title ?? options.content.slice(0, 80),
				tier: options.tier,
				category: options.category,
				sourceKind: process.env.JEDV_TERMINAL_ID ? "agent" : "human",
				sourceRef: process.env.JEDV_TERMINAL_ID,
				supersedeId: options.supersede,
			}),
		};
	},
});
