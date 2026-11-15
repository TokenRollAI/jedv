import { boolean, CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";
export default command({
	description: "Update a local workspace",
	args: [positional("id").required().desc("Workspace ID")],
	options: {
		host: string(),
		local: boolean(),
		name: string(),
		tag: string().variadic(),
		clearTags: boolean(),
	},
	run: async ({ ctx, args, options }) => {
		if (options.tag?.length && options.clearTags)
			throw new CLIError("Cannot combine --tag and --clear-tags");
		const tags = options.clearTags ? [] : options.tag;
		if (options.name === undefined && tags === undefined)
			throw new CLIError("Pass --name, --tag or --clear-tags");
		const id = args.id as string;
		const { target } = await resolveWorkspaceTarget(
			{
				organizationId: ctx.config.organizationId,
				host: options.host,
				local: options.local,
			},
			id,
		);
		return {
			data: await target.client.workspace.update.mutate({
				id,
				...(options.name !== undefined ? { name: options.name } : {}),
				...(tags !== undefined ? { tags } : {}),
			}),
			message: `Updated workspace ${id}`,
		};
	},
});
