import { readFileSync } from "node:fs";
import { boolean, CLIError, string } from "@jedv/cli-framework";
import { TRPCClientError } from "@trpc/client";
import type { CliContext } from "./command";
import { resolveHostTarget } from "./host-target";
export const networkOptions = () => ({
	host: string().desc("Target host (default: local)"),
	local: boolean().desc("Use this machine"),
});
export async function networkClient(
	ctx: CliContext,
	options: { host?: string; local?: boolean },
	feature: "peers" | "mobileAuth" | "declarativeSlots",
) {
	const { client } = await resolveHostTarget({
		requestedHostId: options.host ?? "local",
		organizationId: ctx.config.organizationId,
	});
	try {
		const capability = await client[feature].capabilities.query();
		if (capability.protocolVersion !== 1)
			throw new CLIError("Unsupported host protocol");
	} catch (error) {
		if (
			error instanceof TRPCClientError &&
			["NOT_FOUND", "METHOD_NOT_SUPPORTED", "PRECONDITION_FAILED"].includes(
				error.data?.code ?? "",
			)
		)
			throw new CLIError(
				`${feature} is unsupported by this host`,
				"Update the host and CLI together.",
			);
		throw error;
	}
	return client;
}
export function tokenFromFile(path: string | undefined) {
	if (!path) return undefined;
	const raw = readFileSync(path, "utf8").trim();
	if (!/^[A-Za-z0-9_-]{32,256}$/.test(raw))
		throw new CLIError(
			"Credential file must contain a 32–256 character URL-safe token",
		);
	return raw;
}
