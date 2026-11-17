import { boolean, string } from "@jedv/cli-framework";
import { getHostId } from "@jedv/shared/host-info";
import { command } from "../../../lib/command";
import { resolveHostFilter, resolveHostTarget } from "../../../lib/host-target";
import { table } from "../../../lib/table";

export default command({
	description: "List projects on a host (default: this machine)",
	display: (data) =>
		table(
			data as Record<string, unknown>[],
			["name", "repo", "path", "id"],
			["NAME", "REPO", "PATH", "ID"],
		),
	options: {
		host: string().desc("List projects on a specific host machineId"),
		local: boolean().desc("List projects on this machine (the default)"),
	},
	run: async ({ ctx, options }) => {
		const organizationId = ctx.config.organizationId;

		const hostId =
			resolveHostFilter({
				host: options.host ?? undefined,
				local: options.local ?? undefined,
			}) ?? getHostId();

		const target = await resolveHostTarget({
			requestedHostId: hostId,
			organizationId,
		});
		const projects = await target.client.project.list.query();

		return projects
			.map((project) => ({
				name: project.name,
				repo: project.repoUrl ?? "-",
				path: project.repoPath,
				id: project.id,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
});
