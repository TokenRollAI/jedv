import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Remove an extension and revoke all associated provider tokens",
	options: {
		...networkOptions(),
		id: string().required().desc("Extension ID"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "declarativeSlots")
			).declarativeSlots.uninstall.mutate({ extensionId: options.id }),
		};
	},
});
