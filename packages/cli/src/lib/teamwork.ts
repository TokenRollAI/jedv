import { boolean, CLIError, string } from "@jedv/cli-framework";
import {
	TEAMWORK_PROTOCOL_VERSION,
	type TeamworkActor,
} from "@jedv/shared/teamwork";
import { TRPCClientError } from "@trpc/client";
import type { CliContext } from "./command";
import { resolveHostTarget } from "./host-target";

export const teamworkOptions = () => ({
	team: string().desc("Team ID (default: terminal membership or JEDV_TEAM_ID)"),
	host: string().desc("Local host (cross-host Teamwork is not supported)"),
	local: boolean().desc("Use this machine"),
	callerWorkspace: string().desc(
		"Calling Agent workspace ID (default: JEDV_WORKSPACE_ID)",
	),
	terminal: string().desc(
		"Calling Agent terminal ID (default: JEDV_TERMINAL_ID)",
	),
	launch: string().desc(
		"Calling launch ID (default: native terminal environment)",
	),
	human: boolean().desc(
		"Act as the authenticated human instead of the terminal member",
	),
});
export interface TeamworkCliOptions {
	team?: string;
	host?: string;
	local?: boolean;
	callerWorkspace?: string;
	terminal?: string;
	human?: boolean;
	launch?: string;
}
export function teamworkActor(
	options: TeamworkCliOptions,
	workspace?: string,
): TeamworkActor | undefined {
	if (options.human) return undefined;
	const workspaceId =
		workspace ?? options.callerWorkspace ?? process.env.JEDV_WORKSPACE_ID;
	const terminalId = options.terminal ?? process.env.JEDV_TERMINAL_ID;
	if (workspaceId && terminalId)
		return {
			workspaceId,
			terminalId,
			...((options.launch ?? process.env.JEDV_AGENT_LAUNCH_ID)
				? { launchId: options.launch ?? process.env.JEDV_AGENT_LAUNCH_ID }
				: {}),
		};
	return undefined;
}
export function teamSelection(options: TeamworkCliOptions) {
	return {
		teamId: options.team ?? (process.env.JEDV_TEAM_ID?.trim() || undefined),
		actor: teamworkActor(options),
	};
}
export async function teamworkTarget(
	ctx: CliContext,
	options: TeamworkCliOptions,
) {
	const target = await resolveHostTarget({
		requestedHostId: options.host ?? "local",
		organizationId: ctx.config.organizationId,
	});
	try {
		const capabilities = await target.client.team.capabilities.query();
		if (capabilities.protocolVersion !== TEAMWORK_PROTOCOL_VERSION)
			throw new CLIError(
				"This host does not support this Teamwork protocol",
				"Update the local host and CLI together.",
			);
	} catch (error) {
		if (
			error instanceof TRPCClientError &&
			(error.data?.code === "NOT_FOUND" ||
				error.data?.code === "METHOD_NOT_SUPPORTED")
		)
			throw new CLIError(
				"Teamwork is unsupported by this host",
				"Update the local host before using team or mail commands.",
			);
		throw error;
	}
	return target;
}

export async function teamworkClient(
	ctx: CliContext,
	options: TeamworkCliOptions,
) {
	return (await teamworkTarget(ctx, options)).client;
}
