import { expect, test } from "bun:test";
import { enforceLocalHostEnv } from "./local-host-env";

test("local host strips inherited cloud credentials after the shell merge and keeps its PSK", () => {
	const env: Record<string, string> = {
		AUTH_TOKEN: "old-session",
		JEDV_API_URL: "https://api.example",
		JEDV_AUTH_CONFIG_PATH: "/old/config",
		RELAY_URL: "https://relay.example",
		HOST_SERVICE_SENTRY_DSN: "https://sentry.example",
		NEXT_PUBLIC_POSTHOG_KEY: "old-key",
		HOST_SERVICE_SECRET: "local-psk",
		HOST_DB_PATH: "/local/host.db",
		PATH: "/bin",
	};
	enforceLocalHostEnv(env);
	expect(env).toEqual({
		HOST_SERVICE_SECRET: "local-psk",
		HOST_DB_PATH: "/local/host.db",
		PATH: "/bin",
	});
});
