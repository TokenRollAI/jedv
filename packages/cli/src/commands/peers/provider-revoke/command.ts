import { string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description: "Revoke a provider ingest credential",
	options: {
		...networkOptions(),
		tokenId: string().required().desc("Provider token ID"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.revokeProviderToken.mutate({ tokenId: options.tokenId }),
		};
	},
});
