import { boolean, CLIError, positional, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	resolveWorkspaceHost,
	resolveWorkspaceTarget,
} from "../../../lib/host-workspaces";
import { workspaceLinks } from "../../../lib/open-url";

export default command({
	description: "Show details for a single workspace by id",
	args: [
		positional("id").desc("Workspace ID (defaults to $JEDV_WORKSPACE_ID)"),
	],
	options: {
		host: string().desc("Host on this machine (default: local)"),
		local: boolean().desc("The workspace is on this machine"),
		field: string()
			.alias("f")
			.desc(
				"Print a single field's raw value (e.g. name, branch, worktreePath)",
			),
	},
	run: async ({ ctx, args, options }) => {
		const id = (args.id as string | undefined) ?? process.env.JEDV_WORKSPACE_ID;
		if (!id) {
			throw new CLIError(
				"No workspace id",
				"Pass an id or run inside a workspace where $JEDV_WORKSPACE_ID is set",
			);
		}

		const organizationId = ctx.config.organizationId;

		const hostId = await resolveWorkspaceHost({
			host: options.host,
			local: options.local,
		});
		const detail = await hostDetail(organizationId, id, hostId);

		if (options.field) {
			if (!Object.hasOwn(detail, options.field)) {
				throw new CLIError(
					`Unknown field: ${options.field}`,
					`Available fields: ${Object.keys(detail).join(", ")}`,
				);
			}
			const value = (detail as Record<string, unknown>)[options.field];
			return {
				data: detail,
				message: value === null || value === undefined ? "" : String(value),
			};
		}

		const width = Math.max(...Object.keys(detail).map((key) => key.length));
		const message = Object.entries(detail)
			.map(([key, value]) => {
				const shown = value === null || value === undefined ? "—" : value;
				return `${key.padEnd(width)}  ${shown}`;
			})
			.join("\n");

		return { data: detail, message };
	},
});

async function hostDetail(organizationId: string, id: string, hostId: string) {
	const { workspace } = await resolveWorkspaceTarget(
		{ organizationId, host: hostId },
		id,
	);
	return {
		id: workspace.id,
		name: workspace.name,
		branch: workspace.branch,
		type: workspace.type,
		projectId: workspace.projectId,
		projectName: workspace.projectName ?? workspace.projectId,
		hostId: workspace.hostId,
		hostName: "local",
		taskId: workspace.taskId,
		worktreePath: workspace.worktreePath,
		worktreeExists: workspace.worktreeExists,
		createdAt: workspace.createdAt,
		...workspaceLinks(workspace.id),
	};
}
