import { boolean, number } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { butlerClient, butlerOptions } from "../helpers";
export default command({
	description: "List persisted Butler conversations",
	options: {
		...butlerOptions(),
		limit: number().int().min(1).max(100).default(50).desc("Maximum threads"),
		includeAudit: boolean().desc("Include programmatic approval audit threads"),
	},
	run: async ({ ctx, options }) => ({
		data: await (await butlerClient(ctx, options)).butler.listThreads.query({
			limit: options.limit,
			includeAudit: options.includeAudit ?? false,
		}),
	}),
});
