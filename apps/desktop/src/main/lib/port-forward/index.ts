import { getHostServiceCoordinator } from "../host-service-coordinator";
import { canBindPort } from "../host-service-utils";
import { portManager } from "../terminal/port-manager";
import { DirectForwardTransport } from "./direct-forward-transport";
import { ForwardTokens } from "./forward-tokens";
import { PortForwardManager } from "./port-forward-manager";
import { normalizePrivateEndpoint } from "./private-endpoint";

export {
	type DirectForwardEndpoint,
	DirectForwardTransport,
	type DirectForwardTransportOptions,
} from "./direct-forward-transport";
export { PortForwardManager } from "./port-forward-manager";
export type { ForwardRequestOptions, ForwardTransport } from "./types";

const tokens = new ForwardTokens();
export function setHostToken(hostUrl: string, token: string | null): void {
	tokens.setHostToken(normalizePrivateEndpoint(hostUrl), token);
}
export function hasHostConnection(hostUrl: string): boolean {
	try {
		const origin = normalizePrivateEndpoint(hostUrl);
		return tokens.hasHostConnection(
			origin,
			getHostServiceCoordinator().getConnections(),
		);
	} catch {
		return false;
	}
}
const transport = new DirectForwardTransport({
	resolveEndpoint: (target) => {
		const origin = normalizePrivateEndpoint(target.hostUrl);
		const token = tokens.hostTokenFor(origin);
		return token ? { baseUrl: origin, token } : null;
	},
});
export const portForwardManager = new PortForwardManager({
	transport,
	getLocalPorts: () => portManager.getAllPorts(),
	killLocalPort: ({ terminalId, workspaceId, port }) =>
		portManager.killPort({ terminalId, workspaceId, port }),
	canBindPort,
});
export async function disconnectPrivateHost(hostUrl: string): Promise<void> {
	const origin = normalizePrivateEndpoint(hostUrl);
	tokens.setHostToken(origin, null);
	transport.closeHost(origin);
	await portForwardManager.releaseHost(origin);
}

export async function beginPrivateHostConnection(hostUrl: string) {
	const origin = normalizePrivateEndpoint(hostUrl);
	const attempt = tokens.beginPrivateConnection(origin);
	transport.closeHost(origin);
	try {
		await portForwardManager.releaseHost(origin);
		return attempt;
	} catch (error) {
		attempt.cancel();
		throw error;
	}
}
