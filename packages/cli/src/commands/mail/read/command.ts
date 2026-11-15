import { CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description:
		"Read one delivery and mark it read; acknowledgement is a separate command",
	args: [positional("deliveryId").required().desc("Delivery ID")],
	options: {
		...teamworkOptions(),
		member: string().desc("Recipient member name or ID for human access"),
	},
	run: async ({ ctx, options, args }) => {
		if (!args.deliveryId) throw new CLIError("Missing delivery ID");
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.mail.read.mutate({
				...teamSelection(options),
				member: options.member,
				deliveryId: args.deliveryId,
			}),
		};
	},
});
