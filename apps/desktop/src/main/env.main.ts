import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export const env = createEnv({
	server: {
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		DESKTOP_DISPLAY_NAME: z.string().default("Jedv"),
	},
	runtimeEnv: {
		NODE_ENV: process.env.NODE_ENV,
		DESKTOP_DISPLAY_NAME: process.env.DESKTOP_DISPLAY_NAME,
	},
	emptyStringAsUndefined: true,
	skipValidation:
		process.env.NODE_ENV === "development" && !!process.env.SKIP_ENV_VALIDATION,
	isServer: true,
});
