import { boolean, CLIError, string } from "@jedv/cli-framework";
import { TRPCClientError } from "@trpc/client";
import type { CliContext } from "../../lib/command";
import { resolveHostTarget } from "../../lib/host-target";
export const butlerOptions = () => ({
	host: string().desc("Host ID (default: local)"),
	local: boolean().desc("Use this machine"),
});
export async function butlerClient(
	ctx: CliContext,
	options: { host?: string; local?: boolean },
) {
	const target = await resolveHostTarget({
		requestedHostId: options.host ?? "local",
		organizationId: ctx.config.organizationId,
	});
	try {
		const result = await target.client.butler.capabilities.query();
		if (result.protocolVersion !== 1)
			throw new CLIError("Unsupported Butler protocol");
	} catch (error) {
		if (
			error instanceof TRPCClientError &&
			["NOT_FOUND", "METHOD_NOT_SUPPORTED", "PRECONDITION_FAILED"].includes(
				error.data?.code ?? "",
			)
		)
			throw new CLIError(
				"Butler is unavailable on this host",
				"Update the host and CLI together.",
			);
		throw error;
	}
	return target.client;
}
export async function attentionClient(
	ctx: CliContext,
	options: { host?: string; local?: boolean },
) {
	const client = await butlerClient(ctx, options);
	if (!(await client.butler.capabilities.query()).features?.attention)
		throw new CLIError(
			"Butler attention is unsupported by this host",
			"Update the host and CLI together.",
		);
	return client;
}
export async function conversationClient(
	ctx: CliContext,
	options: { host?: string; local?: boolean },
) {
	const client = await butlerClient(ctx, options);
	if (!(await client.butler.capabilities.query()).features?.conversationState)
		throw new CLIError(
			"Butler conversation state is unsupported by this host",
			"Update the host and CLI together; no default thread will be guessed.",
		);
	return client;
}
