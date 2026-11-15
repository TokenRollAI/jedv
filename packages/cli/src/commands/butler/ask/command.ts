import { randomUUID } from "node:crypto";
import { boolean, CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { butlerOptions, conversationClient } from "../helpers";
export default command({
	description:
		"Send one explicit human message; dangerous actions only produce approval cards",
	options: {
		...butlerOptions(),
		message: string()
			.required()
			.desc("Human message, preserved verbatim in Leader mail"),
		thread: string().desc("Existing thread ID"),
		requestId: string().desc("Stable request retry ID"),
		newTopic: boolean().desc(
			"Start a new topic when this first message is accepted",
		),
		preferredThread: string().desc(
			"Existing conversation to prefer only on first initialization",
		),
		alertId: string().desc("Related alert ID"),
		groupKey: string().desc("Related attention group"),
		approvalId: string().desc("Related approval ID"),
		team: string().desc("Related Team ID"),
		workspace: string().desc("Related Workspace ID"),
	},
	run: async ({ ctx, options }) => {
		const client = await conversationClient(ctx, options),
			requestId = options.requestId ?? randomUUID();
		if (options.newTopic && options.thread)
			throw new CLIError("--new-topic cannot specify --thread");
		const context = {
			alertId: options.alertId,
			groupKey: options.groupKey,
			approvalId: options.approvalId,
			teamId: options.team,
			workspaceId: options.workspace,
		};
		try {
			return {
				data: await client.butler.sendMessage.mutate({
					humanText: options.message,
					threadId: options.thread,
					requestId,
					newTopic: options.newTopic ?? false,
					preferredThreadId: options.preferredThread,
					context: Object.values(context).some((value) => value !== undefined)
						? context
						: undefined,
				}),
			};
		} catch (error) {
			throw new CLIError(
				error instanceof Error ? error.message : "Butler request failed",
				`Inspect history before retrying with the same --request-id ${requestId}.`,
			);
		}
	},
});
