import { CLIError } from "@jedv/cli-framework";
import { type ResolvedHostTarget, resolveHostTarget } from "../host-target";
import { resolveWorkspaceHost } from "./resolveWorkspaceHost";
import {
	type HostWorkspaceRow,
	type HostWorkspacesOptions,
	listWorkspacesOnHost,
} from "./workspacesOnHost";

export interface ResolvedWorkspaceTarget {
	hostId: string;
	workspace: HostWorkspaceRow;
	target: ResolvedHostTarget;
}

/**
 * Where a workspace lives and a client for it: `--local` or `--host` names a
 * host; otherwise the account's default location (see resolveWorkspaceHost).
 * Never guessed from the id.
 */
export async function resolveWorkspaceTarget(
	options: Omit<HostWorkspacesOptions, "hostId"> & {
		host?: string;
		local?: boolean;
	},
	workspaceId: string,
): Promise<ResolvedWorkspaceTarget> {
	const hostId = await resolveWorkspaceHost({
		host: options.host,
		local: options.local,
	});
	return onHost(options, hostId, workspaceId);
}

async function onHost(
	options: Omit<HostWorkspacesOptions, "hostId">,
	hostId: string,
	workspaceId: string,
): Promise<ResolvedWorkspaceTarget> {
	const { workspaces } = await listWorkspacesOnHost({ ...options, hostId });
	const workspace = workspaces.find((row) => row.id === workspaceId);
	if (!workspace) {
		throw new CLIError(
			`Workspace not found on host ${hostId}: ${workspaceId}`,
			"Pass --host <id> if it lives on another machine",
		);
	}
	const target = await resolveHostTarget({
		requestedHostId: hostId,
		organizationId: options.organizationId,
	});
	return { hostId, workspace, target };
}
