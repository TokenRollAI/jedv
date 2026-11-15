import { command } from "../../../lib/command";
import { automationOptions, automationQuery } from "../helpers";
export default command({
	description: "List local automation schedules, status and scheduler errors",
	options: automationOptions(),
	run: async ({ ctx, options }) => ({
		data: await automationQuery(ctx, options, (client) =>
			client.automations.list.query(),
		),
	}),
});
