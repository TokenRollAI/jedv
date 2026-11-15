import { boolean, CLIError, string } from "@jedv/cli-framework";
import { TRPCClientError } from "@trpc/client";
import { command } from "../../../lib/command";
import { requireHostTarget, resolveHostTarget } from "../../../lib/host-target";

export default command({
	description: "Create a project on a host",
	options: {
		folder: string().desc(
			"Existing ordinary directory on the target host; never initializes Git",
		),
		host: string().desc("Target host machineId (required unless --local)"),
		local: boolean().desc("Target this machine (required unless --host)"),
		name: string().required().desc("Project name"),
		clone: string().desc(
			"Git remote URL to clone (requires --parent-dir). Mutually exclusive with --import",
		),
		parentDir: string().desc(
			"Parent directory the cloned repo lands in (required with --clone)",
		),
		import: string().desc(
			"Existing local repo path on the target host. Mutually exclusive with --clone",
		),
	},
	run: async ({ ctx, options }) => {
		const organizationId = ctx.config.organizationId;

		if (
			[options.clone, options.import, options.folder].filter(Boolean).length !==
			1
		) {
			throw new CLIError(
				"Specify exactly one of --clone, --import or --folder",
				"Use --clone <url> --parent-dir <path>, --import <repo> or --folder <path>",
			);
		}
		if (options.clone && !options.parentDir) {
			throw new CLIError(
				"--clone requires --parent-dir",
				"Pass --parent-dir <path> alongside --clone",
			);
		}
		if ((options.import || options.folder) && options.parentDir) {
			throw new CLIError(
				"--parent-dir cannot be used with --import or --folder",
				"--import takes the full repo path",
			);
		}

		const hostId = requireHostTarget({
			host: options.host ?? undefined,
			local: options.local ?? undefined,
		});

		const target = await resolveHostTarget({
			requestedHostId: hostId,
			organizationId,
		});

		if (options.folder) {
			try {
				const capabilities = await target.client.project.capabilities.query();
				if (!capabilities.folderProjects)
					throw new CLIError(
						"Folder projects are unsupported by this host",
						"Update the host before using --folder.",
					);
			} catch (error) {
				if (
					error instanceof TRPCClientError &&
					(error.data?.code === "NOT_FOUND" ||
						error.data?.code === "METHOD_NOT_SUPPORTED")
				) {
					throw new CLIError(
						"Folder projects are unsupported by this host",
						"Update the host before using --folder.",
					);
				}
				throw error;
			}
		}
		const mode = options.folder
			? { kind: "folder" as const, repoPath: options.folder }
			: options.clone
				? {
						kind: "clone" as const,
						parentDir: options.parentDir as string,
						url: options.clone,
					}
				: {
						kind: "importLocal" as const,
						repoPath: options.import as string,
					};

		const result = await target.client.project.create.mutate({
			name: options.name,
			mode,
		});

		return {
			data: result,
			message: `Created project "${options.name}" on host ${target.hostId}`,
		};
	},
});
