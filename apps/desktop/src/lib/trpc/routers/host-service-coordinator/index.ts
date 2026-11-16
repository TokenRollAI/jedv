import { getHostId } from "@jedv/shared/host-info";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import {
	getHostServiceCoordinator,
	type HostServiceStatusEvent,
	isSafeOrganizationId,
} from "main/lib/host-service-coordinator";
import {
	beginPrivateHostConnection,
	disconnectPrivateHost,
	setHostToken,
} from "main/lib/port-forward";
import { normalizePrivateEndpoint } from "main/lib/port-forward/private-endpoint";
import { LOCAL_HOST_NAMESPACE } from "shared/jedv";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { connectPrivateHost } from "./connect-private-host";
import { readTailscaleStatus } from "./tailscale-status";

const orgInput = z.object({
	organizationId: z.string().refine(isSafeOrganizationId, {
		message: "Invalid organization ID",
	}),
});

export const createHostServiceCoordinatorRouter = () => {
	return router({
		getTailscaleStatus: publicProcedure.query(() => readTailscaleStatus()),
		connectPrivateHost: publicProcedure
			.input(
				z.object({
					baseUrl: z.string().max(2048),
					token: z.string().max(4096),
				}),
			)
			.mutation(({ input }) =>
				connectPrivateHost(input, {
					machineId: getHostId(),
					beginConnection: beginPrivateHostConnection,
				}),
			),
		disconnectPrivateHost: publicProcedure
			.input(z.object({ baseUrl: z.string() }))
			.mutation(({ input }) => {
				try {
					return disconnectPrivateHost(normalizePrivateEndpoint(input.baseUrl));
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							error instanceof Error
								? error.message
								: "Invalid private host connection",
					});
				}
			}),

		getConnection: publicProcedure.input(orgInput).query(({ input }) => {
			const coordinator = getHostServiceCoordinator();
			const connection = coordinator.getConnection(input.organizationId);
			if (connection)
				setHostToken(`http://127.0.0.1:${connection.port}`, connection.secret);
			return connection;
		}),

		// All running local host connections, across every org — used to broadcast
		// workspace-session disposal so a non-active-org workspace's terminals are
		// cleaned up regardless of which org is currently active.
		getConnections: publicProcedure.query(() => {
			const coordinator = getHostServiceCoordinator();
			return coordinator.getConnections();
		}),

		getProcessStatus: publicProcedure.input(orgInput).query(({ input }) => {
			const coordinator = getHostServiceCoordinator();
			return { status: coordinator.getProcessStatus(input.organizationId) };
		}),

		restart: publicProcedure.input(orgInput).mutation(async ({ input }) => {
			const coordinator = getHostServiceCoordinator();
			if (input.organizationId !== LOCAL_HOST_NAMESPACE) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the local host can be restarted",
				});
			}
			return coordinator.restart(input.organizationId, {
				mode: "local",
			});
		}),

		reset: publicProcedure.input(orgInput).mutation(async ({ input }) => {
			const coordinator = getHostServiceCoordinator();
			if (input.organizationId !== LOCAL_HOST_NAMESPACE) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the local host can be restarted",
				});
			}
			return coordinator.reset(input.organizationId, {
				mode: "local",
			});
		}),

		onStatusChange: publicProcedure.subscription(() => {
			return observable<HostServiceStatusEvent>((emit) => {
				const coordinator = getHostServiceCoordinator();
				const handler = (event: HostServiceStatusEvent) => emit.next(event);
				coordinator.on("status-changed", handler);
				return () => coordinator.off("status-changed", handler);
			});
		}),
	});
};
