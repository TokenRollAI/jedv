import type { AppRouter } from "@jedv/host-service";
import {
	createTRPCClient,
	httpBatchLink,
	httpLink,
	splitLink,
} from "@trpc/client";
import superjson from "superjson";

export interface LocalConnection {
	port: number;
	secret: string;
	machineId: string;
	baseUrl?: string;
}

export function hostBaseUrl(connection: LocalConnection): string {
	return connection.baseUrl ?? `http://127.0.0.1:${connection.port}`;
}

export function createLocalClient(connection: LocalConnection) {
	const options = {
		url: `${hostBaseUrl(connection)}/trpc`,
		fetch: (url: RequestInfo | URL, init?: RequestInit) =>
			fetch(url, { ...init, redirect: "error" }),
		transformer: superjson,
		headers: {
			Authorization: `Bearer ${connection.secret}`,
			"x-jedv-client-machine-id": connection.machineId,
		},
	};
	return createTRPCClient<AppRouter>({
		links: [
			splitLink({
				condition: (operation) => operation.context.skipBatch === true,
				true: httpLink(options),
				false: httpBatchLink(options),
			}),
		],
	});
}
export type LocalClient = ReturnType<typeof createLocalClient>;
