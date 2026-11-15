import {
	getHostInstallSource,
	HOST_SERVICE_VERSION,
} from "../../../install-source";
import { publicProcedure, router } from "../../index";

export const healthRouter = router({
	check: publicProcedure.query(() => ({
		status: "ok" as const,
		pid: process.pid,
		version: HOST_SERVICE_VERSION,
		installSource: getHostInstallSource(),
	})),
});
