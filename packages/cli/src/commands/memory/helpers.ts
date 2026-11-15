import { boolean, CLIError, string } from "@jedv/cli-framework";
import type { MemoryScope } from "@jedv/shared/memory";
import { TRPCClientError } from "@trpc/client";
import type { CliContext } from "../../lib/command";
import { resolveHostTarget } from "../../lib/host-target";
export const memoryOptions = () => ({
	scope: string()
		.enum("global", "project", "team")
		.desc("Scope (default: current Team, then project)"),
	scopeId: string().desc("Explicit project or Team scope ID"),
	project: string().desc("Project ID"),
	team: string().desc("Team ID"),
	host: string().desc("Host ID (default: local)"),
	local: boolean().desc("Use this machine"),
});
interface Options {
	scope?: "global" | "project" | "team";
	scopeId?: string;
	project?: string;
	team?: string;
	host?: string;
	local?: boolean;
}
export async function memoryTarget(ctx: CliContext, options: Options) {
	const target = await resolveHostTarget({
		requestedHostId: options.host ?? "local",
		organizationId: ctx.config.organizationId,
	});
	const client = target.client;
	try {
		const capabilities = await client.memory.capabilities.query();
		if (capabilities.protocolVersion !== 1)
			throw new CLIError(
				"Unsupported Memory protocol",
				"Update the host and CLI together.",
			);
	} catch (error) {
		if (
			error instanceof TRPCClientError &&
			["NOT_FOUND", "METHOD_NOT_SUPPORTED", "PRECONDITION_FAILED"].includes(
				error.data?.code ?? "",
			)
		)
			throw new CLIError(
				"Memory is unavailable on this host",
				"Update the host before using memory commands.",
			);
		throw error;
	}
	return { client, workspace: target.client.workspace };
}
export async function memoryScope(
	options: Options,
	target: Awaited<ReturnType<typeof memoryTarget>>,
): Promise<MemoryScope> {
	const teamId = options.team ?? process.env.JEDV_TEAM_ID;
	const scopeKind = options.scope ?? (teamId ? "team" : "project");
	if (scopeKind === "global") {
		if (options.scopeId || options.project || options.team)
			throw new CLIError("Global memory has no scope ID");
		return { scopeKind, scopeId: "" };
	}
	let scopeId =
		options.scopeId ??
		(scopeKind === "team"
			? teamId
			: (options.project ?? process.env.JEDV_PROJECT_ID));
	if (!scopeId && scopeKind === "project" && process.env.JEDV_WORKSPACE_ID)
		scopeId =
			(await target.workspace.get.query({ id: process.env.JEDV_WORKSPACE_ID }))
				.projectId ?? undefined;
	if (!scopeId)
		throw new CLIError(
			`Specify --${scopeKind} or --scope-id for ${scopeKind} memory`,
		);
	return { scopeKind, scopeId };
}
