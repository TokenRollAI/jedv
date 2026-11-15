import { CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Resolve a fixed pure-data slot view",
	options: {
		...networkOptions(),
		surface: string().required().desc("teamwork.header or sidebar.panel"),
		team: string().desc("Team ID"),
	},
	run: async ({ ctx, options }) => {
		if (!["teamwork.header", "sidebar.panel"].includes(options.surface))
			throw new CLIError("Unknown slot surface");
		return {
			data: await (
				await networkClient(ctx, options, "declarativeSlots")
			).declarativeSlots.resolveView.query({
				surface: options.surface as "teamwork.header" | "sidebar.panel",
				teamId: options.team,
			}),
		};
	},
});
