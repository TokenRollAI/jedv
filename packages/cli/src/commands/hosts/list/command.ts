import { getHostId } from "@jedv/shared/host-info";
import { command } from "../../../lib/command";
import { readManifest } from "../../../lib/host/manifest";
import { isManifestLive } from "../../../lib/host/manifest-liveness";
import { LOCAL_HOST_NAMESPACE } from "../../../lib/local";
export default command({
	description: "Show this machine's local host",
	run: async () => {
		const manifest = readManifest(LOCAL_HOST_NAMESPACE);
		return [
			{
				id: getHostId(),
				name: "local",
				online: manifest ? await isManifestLive(manifest) : false,
			},
		];
	},
});
