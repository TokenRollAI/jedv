import { number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { butlerClient, butlerOptions } from "../helpers";
export default command({
	description: "Read approval cards without executing any action",
	options: {
		...butlerOptions(),
		status: string()
			.enum("pending", "history", "all")
			.default("pending")
			.desc("Approval filter"),
		thread: string().desc("Thread ID"),
		approval: string().desc("Exact approval ID"),
		limit: number().int().min(1).max(200).default(100).desc("Maximum cards"),
	},
	run: async ({ ctx, options }) => ({
		data: await (await butlerClient(ctx, options)).butler.listApprovals.query({
			status: options.status,
			threadId: options.thread,
			approvalId: options.approval,
			limit: options.limit,
		}),
	}),
});
