import { boolean, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description:
		"Launch a fresh worker in the current workspace, a specified workspace, or a project worktree",
	options: {
		...teamworkOptions(),
		name: string().required().desc("Unique member name"),
		agent: string().required().desc("Agent preset or configured Agent ID"),
		prompt: string().required().desc("Worker task"),
		operationId: string().desc(
			"Stable retry key (default: spawn:<name>); reuse with identical parameters",
		),
		workspace: string().desc(
			"Existing target workspace; defaults to the caller workspace",
		),
		project: string().desc("Create a new worktree in this project"),
		newWorktree: boolean().desc(
			"Create a new worktree in the Team origin project",
		),
		branch: string().desc("New worktree branch (default: unique Team branch)"),
		baseBranch: string().desc("Base branch for a new worktree"),
		model: string().desc("Configured Agent model"),
		effort: string().desc("Reasoning effort"),
		mode: string().desc("Configured Agent mode"),
	},
	run: async ({ ctx, options }) => {
		const client = await teamworkClient(ctx, options);
		return {
			data: await client.team.spawn.mutate({
				...teamSelection(options),
				name: options.name,
				operationId: options.operationId ?? `spawn:${options.name}`,
				agent: options.agent,
				prompt: options.prompt,
				workspaceId: options.workspace,
				projectId: options.project,
				newWorktree: options.newWorktree ?? false,
				branch: options.branch,
				baseBranch: options.baseBranch,
				model: options.model,
				effort: options.effort,
				mode: options.mode,
			}),
		};
	},
});
