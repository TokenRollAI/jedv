import { CLIError } from "@jedv/cli-framework";
import type { AppRouter as HostServiceRouter } from "@jedv/host-service/trpc";
import { getHostId } from "@jedv/shared/host-info";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
import { isProcessAlive, readManifest } from "../host/manifest";

export type HostServiceClient = ReturnType<
	typeof createTRPCClient<HostServiceRouter>
>;
export interface HostWsEndpoint {
	baseWsUrl: string;
	token: string;
}
export type ResolvedHostTarget = {
	kind: "local";
	hostId: string;
	client: HostServiceClient;
	ws: HostWsEndpoint;
};
export interface ResolveHostTargetOptions {
	requestedHostId: string;
	organizationId: string;
}
export async function resolveHostTarget(
	options: ResolveHostTargetOptions,
): Promise<ResolvedHostTarget> {
	const localHostId = getHostId();
	if (![localHostId, "local"].includes(options.requestedHostId)) {
		throw new CLIError(
			"Only this machine is supported by the local CLI",
			"Omit --host or use --local.",
		);
	}
	const manifest = readManifest(options.organizationId);
	if (!manifest || !isProcessAlive(manifest.pid)) {
		throw new CLIError(
			"Local host service is not running",
			"Run: jedv start --daemon",
		);
	}
	const endpoint = new URL(manifest.endpoint);
	if (
		endpoint.protocol !== "http:" ||
		!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
	) {
		throw new CLIError(
			"Local host manifest must name a loopback HTTP endpoint",
		);
	}
	return {
		kind: "local",
		hostId: localHostId,
		client: createTRPCClient<HostServiceRouter>({
			links: [
				httpBatchLink({
					url: `${manifest.endpoint}/trpc`,
					transformer: SuperJSON,
					headers: {
						Authorization: `Bearer ${manifest.authToken}`,
						"x-jedv-client-machine-id": localHostId,
					},
				}),
			],
		}),
		ws: {
			baseWsUrl: manifest.endpoint.replace(/^http/, "ws"),
			token: manifest.authToken,
		},
	};
}
