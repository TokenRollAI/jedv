import { CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { teamworkClient, teamworkOptions } from "../../../lib/teamwork";
export default command({
	description:
		"Start a new Team task with one host-owned native Leader; retries reuse the same operation ID",
	options: {
		...teamworkOptions(),
		operationId: string()
			.required()
			.desc(
				"Stable start operation ID; never change it after an uncertain result",
			),
		workspace: string()
			.required()
			.desc("Existing Workspace ID (plain folders supported)"),
		agent: string().required().desc("Configured native Agent ID"),
		prompt: string().required().desc("Task the Leader starts immediately"),
		name: string().desc("Team name (default: task first line, 48 characters)"),
		leaderName: string().desc("Leader member name (default: leader)"),
		model: string().desc("Agent model"),
		effort: string().desc("Reasoning effort"),
		mode: string().desc("Agent permission mode"),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		if (!(await client.team.capabilities.query()).features?.start)
			throw new CLIError(
				"Team start is unsupported by this host",
				"Update the host before starting a new Team task.",
			);
		return {
			data: await client.team.start.mutate({
				operationId: options.operationId,
				workspaceId: options.workspace,
				agent: options.agent,
				prompt: options.prompt,
				name: options.name,
				leaderName: options.leaderName,
				model: options.model,
				effort: options.effort,
				mode: options.mode,
			}),
		};
	},
});
