import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { butlerClient, butlerOptions } from "../helpers";
export default command({
	description:
		"Approve or reject exactly one hash-bound, unexpired action card",
	options: {
		...butlerOptions(),
		approval: string().required().desc("Approval ID"),
		payloadHash: string()
			.required()
			.desc("Exact SHA-256 payloadHash from the displayed card"),
		decision: string()
			.enum("approve", "reject")
			.required()
			.desc("Explicit decision"),
	},
	run: async ({ ctx, options }) => ({
		data: await (
			await butlerClient(ctx, options)
		).butler.resolveApproval.mutate({
			approvalId: options.approval,
			payloadHash: options.payloadHash,
			decision: options.decision,
		}),
	}),
});
