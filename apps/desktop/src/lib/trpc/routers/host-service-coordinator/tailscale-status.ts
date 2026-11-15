import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TailscaleStatus } from "shared/types/private-hosts";
import { getProcessEnvWithShellPath } from "../workspaces/utils/shell-env";

const runFile = promisify(execFile);

export function parseTailscaleStatus(value: string): TailscaleStatus {
	const data = JSON.parse(value) as {
		BackendState?: string;
		Self?: { DNSName?: string; TailscaleIPs?: string[] };
		Health?: string[];
	};
	return {
		installed: true,
		state: data.BackendState ?? "Unknown",
		dnsName: data.Self?.DNSName?.replace(/\.$/, "") ?? null,
		addresses: data.Self?.TailscaleIPs ?? [],
		health: data.Health ?? [],
	};
}

export async function readTailscaleStatus(): Promise<TailscaleStatus> {
	try {
		const env = await getProcessEnvWithShellPath(
			process.env as Record<string, string>,
		);
		const { stdout } = await runFile("tailscale", ["status", "--json"], {
			env,
			timeout: 4_000,
			maxBuffer: 4 * 1024 * 1024,
		});
		return parseTailscaleStatus(stdout);
	} catch (error) {
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		return {
			installed: !missing,
			state: missing ? "Not installed" : "Unavailable",
			dnsName: null,
			addresses: [],
			health: [
				missing
					? "Tailscale CLI is not installed"
					: "Could not read Tailscale status; check the local Tailscale app",
			],
		};
	}
}
