import { CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Explicitly acknowledge a completed delivery",
	args: [positional("deliveryId").required().desc("Delivery ID")],
	options: {
		...teamworkOptions(),
		member: string().desc("Recipient member name or ID for human access"),
	},
	run: async ({ ctx, options, args }) => {
		if (!args.deliveryId) throw new CLIError("Missing delivery ID");
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.mail.ack.mutate({
				...teamSelection(options),
				member: options.member,
				deliveryId: args.deliveryId,
			}),
		};
	},
});
