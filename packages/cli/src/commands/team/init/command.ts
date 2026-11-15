import { CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamworkActor,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description: "Promote the current live native Agent terminal to Team leader",
	options: {
		...teamworkOptions(),
		name: string().required().desc("Team name"),
		goal: string().desc("Shared Team goal"),
		leaderName: string().desc("Leader member name (default: leader)"),
		workspace: string().desc(
			"Calling workspace ID (default: terminal environment)",
		),
	},
	run: async ({ ctx, options }) => {
		const actor = teamworkActor(options, options.workspace);
		if (!actor)
			throw new CLIError(
				"Team init requires a native Agent terminal identity",
				"Run inside its Jedv terminal, or supply --workspace and --terminal.",
			);
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.init.mutate({
				actor,
				name: options.name,
				goal: options.goal ?? "",
				leaderName: options.leaderName ?? "leader",
			}),
		};
	},
});
