import { boolean, CLIError } from "@jedv/cli-framework";
import { command } from "../../lib/command";
import { readManifest, removeManifestIfOwnedBy } from "../../lib/host/manifest";
import { stopTerminalDaemon } from "../../lib/host/terminal-daemon";
import { LOCAL_HOST_NAMESPACE } from "../../lib/local";
import { stopOwnedHost } from "./stop-host";

export default command({
	sandbox: false,
	description: "Stop the host service daemon",
	options: {
		terminals: boolean().desc(
			"Also stop the terminal daemon, ending every terminal and agent",
		),
	},
	run: async ({ options }) => {
		const organization = { id: LOCAL_HOST_NAMESPACE, name: "Jedv local" };

		const manifest = readManifest(organization.id);
		let stoppedHostPid: number | null = null;
		if (manifest) {
			try {
				if (await stopOwnedHost(manifest)) stoppedHostPid = manifest.pid;
			} catch (error) {
				throw new CLIError(
					`Failed to stop host service (pid ${manifest.pid}): ${
						error instanceof Error ? error.message : "unknown error"
					}`,
				);
			}
			removeManifestIfOwnedBy(organization.id, manifest.pid);
		}

		let terminalDaemonPids: number[] = [];
		if (options.terminals) {
			try {
				terminalDaemonPids = await stopTerminalDaemon(organization.id);
			} catch (error) {
				throw new CLIError(
					`Failed to stop the terminal daemon: ${
						error instanceof Error ? error.message : "unknown error"
					}`,
				);
			}
		}

		if (stoppedHostPid === null && terminalDaemonPids.length === 0) {
			return {
				data: { running: false },
				message: `No host service running for ${organization.name}`,
			};
		}

		const stopped = [
			stoppedHostPid !== null ? "host service" : null,
			terminalDaemonPids.length > 0 ? "terminal daemon" : null,
		]
			.filter(Boolean)
			.join(" and ");
		return {
			data: {
				pid: stoppedHostPid,
				terminalDaemonPids,
				organizationId: organization.id,
			},
			message: `Stopped ${stopped} for ${organization.name}`,
		};
	},
});
