import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Install a local JSON data-only extension manifest",
	options: {
		...networkOptions(),
		manifest: string()
			.required()
			.desc("Absolute manifest JSON path on target host"),
		team: string().desc("Bind provider and views to this Team ID"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "declarativeSlots")
			).declarativeSlots.install.mutate({
				manifestPath: options.manifest,
				bindTeamId: options.team,
			}),
		};
	},
});
