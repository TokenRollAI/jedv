import os from "node:os";
import { getHostId, getHostName } from "@jedv/shared/host-info";
import {
	getHostInstallSource,
	HOST_SERVICE_VERSION,
} from "../../../install-source";
import { protectedProcedure, router } from "../../index";

export const hostRouter = router({
	info: protectedProcedure.query(() => ({
		hostId: getHostId(),
		hostName: getHostName(),
		version: HOST_SERVICE_VERSION,
		installSource: getHostInstallSource(),
		platform: os.platform(),
		arch: os.arch(),
		uptime: process.uptime(),
	})),
});
