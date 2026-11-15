import { z } from "zod/v4";

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DESKTOP_DISPLAY_NAME: z.string().default("Jedv"),
});

const rawEnv = {
	NODE_ENV: process.env.NODE_ENV,
	DESKTOP_DISPLAY_NAME: process.env.DESKTOP_DISPLAY_NAME,
};
const SKIP_ENV_VALIDATION =
	process.env.NODE_ENV === "development" && !!process.env.SKIP_ENV_VALIDATION;

export const env = {
	...(SKIP_ENV_VALIDATION
		? (rawEnv as z.infer<typeof envSchema>)
		: envSchema.parse(rawEnv)),
	SKIP_ENV_VALIDATION,
};
