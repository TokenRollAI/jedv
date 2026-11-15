import { command } from "../../lib/command";
import { checkHostHealth } from "../../lib/host/health";
import { isProcessAlive, readManifest } from "../../lib/host/manifest";
import { isManifestLive } from "../../lib/host/manifest-liveness";
import { LOCAL_HOST_NAMESPACE } from "../../lib/local";

export default command({
	description: "Check the local headless host",
	run: async () => {
		const manifest = readManifest(LOCAL_HOST_NAMESPACE);
		if (!manifest)
			return { data: { running: false }, message: "Local host is not running" };
		if (!(await isManifestLive(manifest))) {
			const reason = isProcessAlive(manifest.pid)
				? "belongs to a different process"
				: "is dead";
			return {
				data: { running: false, stale: true, pid: manifest.pid },
				message: `Local host is not running: recorded process ${manifest.pid} ${reason}`,
			};
		}
		const health = await checkHostHealth(manifest.endpoint, manifest.authToken);
		return {
			data: {
				running: true,
				healthy: health.healthy,
				pid: manifest.pid,
				endpoint: manifest.endpoint,
				uptimeSec: Math.floor((Date.now() - manifest.startedAt) / 1000),
			},
			message: `Local host ${manifest.endpoint}: ${health.healthy ? "ready" : "unhealthy"}`,
		};
	},
});
