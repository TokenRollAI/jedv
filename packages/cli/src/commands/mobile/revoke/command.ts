import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Revoke one restricted mobile session",
	options: {
		...networkOptions(),
		session: string().required().desc("Mobile session ID"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "mobileAuth")
			).mobileAuth.revokeSession.mutate({ sessionId: options.session }),
		};
	},
});
