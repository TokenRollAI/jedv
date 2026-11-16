import type { AppRouter as HostRouter } from "@jedv/host-service";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import type { PrivateHostConnection } from "shared/types/private-hosts";
import superjson from "superjson";
import {
	normalizePrivateEndpoint,
	validatePrivateHostToken,
} from "../../../../main/lib/port-forward/private-endpoint";

interface ConnectionAttempt {
	commit(token: string): boolean;
	cancel(): void;
}

export async function connectPrivateHost(
	input: { baseUrl: string; token: string },
	options: {
		machineId: string;
		beginConnection(
			origin: string,
		): ConnectionAttempt | Promise<ConnectionAttempt>;
	},
): Promise<PrivateHostConnection> {
	let baseUrl: string;
	let token: string;
	try {
		baseUrl = normalizePrivateEndpoint(input.baseUrl.trim());
		token = validatePrivateHostToken(input.token);
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				error instanceof Error
					? error.message
					: "Invalid private host connection",
		});
	}
	const attempt = await options.beginConnection(baseUrl);
	try {
		const client = createTRPCClient<HostRouter>({
			links: [
				httpBatchLink({
					url: `${baseUrl}/trpc`,
					transformer: superjson,
					headers: {
						Authorization: `Bearer ${token}`,
						"x-jedv-client-machine-id": options.machineId,
					},
					fetch: (url, request) =>
						fetch(url, {
							...request,
							redirect: "error",
							signal: AbortSignal.timeout(8_000),
						}),
				}),
			],
		});
		await client.workspace.list.query();
		if (!attempt.commit(token)) throw new Error("Connection attempt revoked");
		return { baseUrl, machineId: options.machineId };
	} catch {
		attempt.cancel();
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Private host connection failed. Check endpoint, PSK, TLS certificate and Tailscale access.",
		});
	}
}
