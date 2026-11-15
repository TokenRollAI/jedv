import { boolean, CLIError, number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { resolveHostTarget } from "../../../lib/host-target";
import { resolveWorkspaceHost } from "../../../lib/host-workspaces";
import { workspaceLinks } from "../../../lib/open-url";
import { uploadAttachments } from "../../../lib/upload-attachments";

export default command({
	description: "Create a local workspace or worktree",
	options: {
		host: string().desc("Host on this machine"),
		local: boolean().desc("Create on this machine"),
		project: string().desc(
			"Project ID, for a workspace on a host. Required with --local or --host unless --session",
		),
		session: boolean().desc(
			"Create a project-less session (a managed scratch folder) on a host. Cannot be combined with --project",
		),
		name: string().desc("Workspace name"),
		checkout: string().desc(
			"Where the files live: `worktree` (default) checks out --branch in its own worktree; `local` uses the project's checkout as it is — no branch switch, files shared with the project's other local workspaces",
		),
		branch: string().desc(
			"Git branch for the worktree; required unless --pr or --checkout local is set",
		),
		pr: number().desc("PR number — checks out the verified PR head"),
		baseBranch: string().desc(
			"Branch to start from when the requested branch does not exist (default: project default)",
		),
		skipBranchPrefix: boolean().desc(
			"Use --branch exactly as given instead of namespacing it under the project branch prefix",
		),
		agent: string().desc(
			"Agent to spawn after creation. Configured local agent id",
		),
		prompt: string().desc(
			"Initial prompt the agent starts with. Required when --agent is set",
		),
		model: string().desc(
			"Model for the spawned agent (agent-specific; omit to use the agent default)",
		),
		effort: string().desc(
			"Reasoning effort for the spawned agent (agent-specific; omit to use the agent default)",
		),
		command: string().desc(
			"Shell command to run in the new workspace after creation",
		),
		attachment: string()
			.variadic()
			.desc(
				"Local file path to give the agent as an attachment. Repeatable. Only used when --agent is set",
			),
		tag: string()
			.variadic()
			.desc(
				"Workspace tag. Repeatable. Each tag files the workspace into a sidebar folder of the same name",
			),
	},
	run: async ({ ctx, options }) => {
		const organizationId = ctx.config.organizationId;

		const defaultHostId = await resolveWorkspaceHost({
			host: options.host,
			local: options.local,
		});
		const projectId = options.project;
		if (options.session && projectId !== undefined) {
			throw new CLIError("--session cannot be combined with --project");
		}
		if (projectId === undefined && !options.session) {
			throw new CLIError(
				"Specify --project or --session",
				"Use --project <id> for a project workspace or --session for a project-less scratch folder",
			);
		}
		const isSession = projectId === undefined;
		const checkout = options.checkout ?? "worktree";
		if (checkout !== "worktree" && checkout !== "local") {
			throw new CLIError(
				`Unknown checkout "${checkout}"`,
				"Use --checkout worktree or --checkout local",
			);
		}
		if (isSession && options.checkout !== undefined) {
			throw new CLIError(
				"--checkout requires --project",
				"Sessions are project-less scratch folders with no checkout to share",
			);
		}
		if (isSession) {
			for (const [flag, value] of [
				["--branch", options.branch],
				["--pr", options.pr],
				["--base-branch", options.baseBranch],
				["--skip-branch-prefix", options.skipBranchPrefix || undefined],
				["--tag", options.tag?.length ? options.tag : undefined],
			] as const) {
				if (value !== undefined) {
					throw new CLIError(
						`${flag} requires --project`,
						"Sessions are project-less scratch folders with no git branch semantics",
					);
				}
			}
		} else if (checkout === "local") {
			for (const [flag, value] of [
				["--branch", options.branch],
				["--pr", options.pr],
				["--base-branch", options.baseBranch],
				["--skip-branch-prefix", options.skipBranchPrefix || undefined],
			] as const) {
				if (value !== undefined) {
					throw new CLIError(
						`${flag} cannot be combined with --checkout local`,
						"A local workspace uses the project's checkout as it is; pick --checkout worktree to check out a branch",
					);
				}
			}
		} else {
			if (options.branch && options.pr) {
				throw new CLIError(
					"Specify only one of --branch or --pr",
					"Use --branch <name> or --pr <number>",
				);
			}
			if (!options.branch && !options.pr) {
				throw new CLIError(
					"Specify --branch, --pr, or --checkout local",
					"Use --branch <name>, --pr <number>, or --checkout local",
				);
			}
		}

		if (options.prompt && !options.agent) {
			throw new CLIError(
				"--prompt requires --agent",
				"Pass --agent <id> alongside --prompt",
			);
		}
		if (options.agent && !options.prompt) {
			throw new CLIError(
				"--agent requires --prompt",
				"Pass --prompt <text> alongside --agent",
			);
		}
		if (options.effort && !options.agent) {
			throw new CLIError(
				"--effort requires --agent",
				"Pass --agent <id> alongside --effort",
			);
		}
		if (options.model && !options.agent) {
			throw new CLIError(
				"--model requires --agent",
				"Pass --agent <id> alongside --model",
			);
		}
		if (options.attachment && options.attachment.length > 0 && !options.agent) {
			throw new CLIError(
				"--attachment requires --agent",
				"Attachments are only meaningful when launching an agent",
			);
		}

		const hostId = defaultHostId;

		const target = await resolveHostTarget({
			requestedHostId: hostId,
			organizationId,
		});

		if (!isSession && !options.name) {
			throw new CLIError("--name is required when --project is set");
		}

		const attachmentIds = options.attachment
			? await uploadAttachments({
					target,

					paths: options.attachment,
				})
			: [];

		const agents =
			options.agent && options.prompt
				? [
						{
							agent: options.agent,
							prompt: options.prompt,
							model: options.model,
							effort: options.effort,
							...(attachmentIds.length > 0 ? { attachmentIds } : {}),
						},
					]
				: undefined;

		if (isSession) {
			const result = await target.client.workspaces.createSession.mutate({
				name: options.name,
				agents,
				command: options.command ?? undefined,
			});
			const links = workspaceLinks(result.workspace.id);
			return {
				data: { ...result, ...links },
				message: `Created session "${result.workspace.name}" on host ${target.hostId}\n${links.url}`,
			};
		}

		if (!options.name) {
			throw new CLIError("--name is required when --project is set");
		}
		const create =
			checkout === "local"
				? target.client.workspaces.createLocal
				: target.client.workspaces.create;
		const result = await create.mutate({
			projectId,
			name: options.name,
			...(checkout === "local" ? { checkout } : {}),
			branch: options.branch,
			pr: options.pr,
			baseBranch: options.baseBranch,
			skipBranchPrefix: options.skipBranchPrefix ?? undefined,
			agents,
			command: options.command ?? undefined,
			...(options.tag?.length ? { tags: options.tag } : {}),
		});

		const links = workspaceLinks(result.workspace.id);
		const summary = result.alreadyExists
			? `Reused existing workspace "${result.workspace.name}" on host ${target.hostId}`
			: `Created workspace "${result.workspace.name}" on host ${target.hostId}`;
		return {
			data: { ...result, ...links },
			message: `${summary}\n${links.url}`,
		};
	},
});
