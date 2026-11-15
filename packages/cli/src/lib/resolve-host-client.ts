import { getHostId } from "@jedv/shared/host-info";
import type { CliContext } from "./command";
import { type HostServiceClient, resolveHostTarget } from "./host-target";
export async function resolveHostClient(
	ctx: CliContext,
	options: { host?: string | null; workspace?: string | null },
): Promise<HostServiceClient> {
	return (
		await resolveHostTarget({
			requestedHostId: options.host ?? getHostId(),
			organizationId: ctx.config.organizationId,
		})
	).client;
}
