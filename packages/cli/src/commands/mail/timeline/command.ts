import { number } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description:
		"Read the Team mail event timeline without acknowledging deliveries",
	options: {
		...teamworkOptions(),
		limit: number().int().min(1).max(500).default(100).desc("Maximum events"),
	},
	run: async ({ ctx, options }) => ({
		data: await (await teamworkClient(ctx, options)).mail.timeline.query({
			...teamSelection(options),
			limit: options.limit,
		}),
	}),
});
