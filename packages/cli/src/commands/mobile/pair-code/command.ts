import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Generate a one-use five-minute mobile pairing code",
	options: { ...networkOptions() },
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "mobileAuth")
			).mobileAuth.createPairingCode.mutate(),
		};
	},
});
