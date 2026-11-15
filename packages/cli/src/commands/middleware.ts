import { middleware } from "@jedv/cli-framework";
import { LOCAL_HOST_NAMESPACE } from "../lib/local";

export default middleware(async (opts) =>
	opts.next({
		ctx: { config: { organizationId: LOCAL_HOST_NAMESPACE } },
	}),
);
