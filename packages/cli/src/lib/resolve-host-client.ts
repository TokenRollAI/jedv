import { getHostId } from "@jedv/shared/host-info";
import type { CliContext } from "./command";
import {
	type HostServiceClient,
	resolveHostFilter,
	resolveHostTarget,
} from "./host-target";
export async function resolveHostClient(
	ctx: CliContext,
	options: {
		host?: string | null;
		local?: boolean | null;
		workspace?: string | null;
	},
): Promise<HostServiceClient> {
	const hostId = resolveHostFilter({
		host: options.host ?? undefined,
		local: options.local ?? undefined,
	});
	return (
		await resolveHostTarget({
			requestedHostId: hostId ?? getHostId(),
			organizationId: ctx.config.organizationId,
		})
	).client;
}
