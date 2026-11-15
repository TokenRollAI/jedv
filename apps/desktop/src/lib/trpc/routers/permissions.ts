import { publicProcedure, router } from "..";
import {
	getPermissionStatus,
	requestAccessibility,
	requestAppleEvents,
	requestFullDiskAccess,
	requestLocalNetwork,
} from "./permissions/native-permissions";

export const createPermissionsRouter = () => {
	return router({
		getStatus: publicProcedure.query(() => {
			return getPermissionStatus();
		}),

		requestFullDiskAccess: publicProcedure.mutation(async () => {
			await requestFullDiskAccess();
		}),

		requestAccessibility: publicProcedure.mutation(async () => {
			await requestAccessibility();
		}),

		requestAppleEvents: publicProcedure.mutation(async () => {
			await requestAppleEvents();
		}),

		requestLocalNetwork: publicProcedure.mutation(async () => {
			await requestLocalNetwork();
		}),
	});
};

export type PermissionsRouter = ReturnType<typeof createPermissionsRouter>;
