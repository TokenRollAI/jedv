export function enforceLocalHostEnv(env: Record<string, string>): void {
	for (const key of [
		"AUTH_TOKEN",
		"JEDV_API_URL",
		"JEDV_AUTH_CONFIG_PATH",
		"RELAY_URL",
		"HOST_SERVICE_SENTRY_DSN",
		"HOST_SERVICE_SENTRY_RELEASE",
		"HOST_SERVICE_SENTRY_ENVIRONMENT",
		"SENTRY_DSN",
		"NEXT_PUBLIC_POSTHOG_KEY",
	])
		delete env[key];
}
