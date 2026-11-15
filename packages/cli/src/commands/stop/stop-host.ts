import type { HostServiceManifest } from "../../lib/host/manifest";
import { isManifestLive } from "../../lib/host/manifest-liveness";
import { terminateProcess } from "../../lib/host/terminate";

export async function stopOwnedHost(
	manifest: HostServiceManifest,
	deps = { isLive: isManifestLive, terminate: terminateProcess },
): Promise<boolean> {
	if (!(await deps.isLive(manifest))) return false;
	await deps.terminate(manifest.pid);
	return true;
}
