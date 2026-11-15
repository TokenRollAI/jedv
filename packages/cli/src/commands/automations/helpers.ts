import { boolean, CLIError, string } from "@jedv/cli-framework";
import { TRPCClientError } from "@trpc/client";
import type { CliContext } from "../../lib/command";
import { resolveHostTarget } from "../../lib/host-target";
export const automationOptions = () => ({
	host: string().desc("Host ID (default: local)"),
	local: boolean().desc("Use this machine"),
});
export async function automationQuery<T>(
	ctx: CliContext,
	options: { host?: string },
	query: (
		client: Awaited<ReturnType<typeof resolveHostTarget>>["client"],
	) => Promise<T>,
) {
	const target = await resolveHostTarget({
		requestedHostId: options.host ?? "local",
		organizationId: ctx.config.organizationId,
	});
	try {
		return await query(target.client);
	} catch (error) {
		if (
			error instanceof TRPCClientError &&
			(error.data?.code === "METHOD_NOT_SUPPORTED" ||
				(error.data?.code === "NOT_FOUND" &&
					error.message.startsWith("No procedure found on path")))
		)
			throw new CLIError(
				"Automation queries are unsupported by this host",
				"Update the host and CLI together.",
			);
		throw error;
	}
}
