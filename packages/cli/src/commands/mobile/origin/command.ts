import { boolean, CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { networkClient, networkOptions } from "../../../lib/network";
export default command({
	description:
		"Read or explicitly set the single trusted HTTPS .ts.net mobile origin",
	options: {
		...networkOptions(),
		origin: string().desc(
			"HTTPS .ts.net origin (changes revoke every mobile session)",
		),
		clear: boolean().desc(
			"Disable remote mobile origin and revoke every session",
		),
	},
	run: async ({ ctx, options }) => {
		if (options.origin && options.clear)
			throw new CLIError("Use --origin or --clear");
		const client = await networkClient(ctx, options, "mobileAuth");
		return {
			data:
				options.origin || options.clear
					? await client.mobileAuth.setOrigin.mutate({
							origin: options.clear ? null : (options.origin ?? null),
						})
					: await client.mobileAuth.getOrigin.query(),
		};
	},
});
