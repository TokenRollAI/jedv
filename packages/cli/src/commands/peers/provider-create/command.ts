import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description:
		"Issue a provider ingest token for one Team and event type prefix",
	options: {
		...networkOptions(),
		name: string().required().desc("Provider name"),
		team: string().required().desc("Target Team ID"),
		to: string().default("leader").desc("Allowed recipient"),
		typePrefix: string().required().desc("provider.<id>. prefix"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.createProviderToken.mutate({
				name: options.name,
				teamId: options.team,
				allowedTo: options.to,
				typePrefix: options.typePrefix,
			}),
		};
	},
});
