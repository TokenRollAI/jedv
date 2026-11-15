export type HostHealth = {
	healthy: boolean;
	/**
	 * Build serving requests. Equals the desktop app's version when the app
	 * spawned the service, which is how a standalone CLI learns the app version.
	 */
	version?: string;
};

export async function checkHostHealth(
	endpoint: string,
	authToken: string,
): Promise<HostHealth> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 2_000);
	try {
		const res = await fetch(`${endpoint}/trpc/health.check`, {
			signal: controller.signal,
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!res.ok) return { healthy: false };
		const body = (await res.json()) as {
			result?: { data?: { json?: Record<string, unknown> } };
		};
		const payload = body.result?.data?.json;
		return {
			healthy: true,
			version:
				typeof payload?.version === "string" ? payload.version : undefined,
		};
	} catch {
		return { healthy: false };
	} finally {
		clearTimeout(timeout);
	}
}
