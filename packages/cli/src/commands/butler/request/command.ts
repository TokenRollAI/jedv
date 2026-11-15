import { CLIError, string } from "@jedv/cli-framework";
import { guardedActionSchema } from "@jedv/shared/butler";
import { command } from "../../../lib/command";
import { butlerClient, butlerOptions } from "../helpers";
export default command({
	description:
		"Request a pending, hash-bound approval without calling a model or executing the action",
	options: {
		...butlerOptions(),
		requestId: string()
			.required()
			.desc("Stable retry ID; reuse only for the identical request"),
		thread: string().desc("Existing thread ID"),
		message: string().required().desc("Request text, preserved verbatim"),
		action: string()
			.required()
			.desc(
				"Guarded action JSON: archiveWorkspace, stopTeam, deleteMemoryBatch or acceptGlobalMemory",
			),
	},
	run: async ({ ctx, options }) => {
		let action: ReturnType<typeof guardedActionSchema.parse>;
		try {
			action = guardedActionSchema.parse(JSON.parse(options.action));
		} catch {
			throw new CLIError(
				"Invalid guarded action JSON",
				"Use a supported actionType and its target IDs.",
			);
		}
		const client = await butlerClient(ctx, options);
		const capabilities = await client.butler.capabilities.query();
		if (!capabilities.features?.requestApproval)
			throw new CLIError(
				"Direct approval requests are unsupported by this host",
				"Update the host before using butler request.",
			);
		return {
			data: await client.butler.requestApproval.mutate({
				requestId: options.requestId,
				threadId: options.thread,
				humanText: options.message,
				action,
			}),
		};
	},
});
