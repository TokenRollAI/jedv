import { boolean, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	networkClient,
	networkOptions,
	tokenFromFile,
} from "../../../lib/network";
export default command({
	description:
		"Register an HTTPS .ts.net peer; new inbound token is shown once",
	options: {
		...networkOptions(),
		id: string().required().desc("Remote host ID from peers list"),
		name: string().required().desc("Peer display name"),
		origin: string().required().desc("HTTPS .ts.net origin without a path"),
		inboundTokenFile: string().desc(
			"Local file containing the independent inbound token (generated when omitted)",
		),
		outboundTokenFile: string().desc(
			"Local file containing the remote-issued inbound token",
		),
		disabled: boolean().desc("Disable this peer"),
	},
	run: async ({ ctx, options }) => {
		return {
			data: await (
				await networkClient(ctx, options, "peers")
			).peers.upsert.mutate({
				id: options.id,
				name: options.name,
				origin: options.origin,
				inboundToken: tokenFromFile(options.inboundTokenFile),
				outboundToken: tokenFromFile(options.outboundTokenFile),
				enabled: !options.disabled,
			}),
		};
	},
});
