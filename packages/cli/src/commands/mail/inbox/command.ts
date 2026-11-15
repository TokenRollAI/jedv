import { number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "List mail without reading or acknowledging it",
	options: {
		...teamworkOptions(),
		member: string().desc(
			"Recipient member name or ID (human access); default: current member",
		),
		status: string()
			.enum("unread", "all")
			.default("unread")
			.desc("Unacknowledged mail, or all mail"),
		limit: number()
			.int()
			.min(1)
			.max(500)
			.default(20)
			.desc("Maximum deliveries per response"),
		after: string().desc("Delivery cursor from a previous response"),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		const input = {
			...teamSelection(options),
			member: options.member,
			includeAcked: options.status === "all",
			limit: options.limit,
			after: options.after,
		};
		const result = await client.mail.inbox.query(input);
		return { data: result };
	},
});
