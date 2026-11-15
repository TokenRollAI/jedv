import { expect, test } from "bun:test";
import { parseTailscaleStatus } from "./tailscale-status";

test("Tailscale status uses structured CLI output without peer or credential data", () => {
	expect(
		parseTailscaleStatus(
			JSON.stringify({
				BackendState: "Running",
				Self: {
					DNSName: "worker.tailnet.ts.net.",
					TailscaleIPs: ["100.64.0.1"],
				},
				Health: ["warning"],
				Peer: { secret: {} },
			}),
		),
	).toEqual({
		installed: true,
		state: "Running",
		dnsName: "worker.tailnet.ts.net",
		addresses: ["100.64.0.1"],
		health: ["warning"],
	});
	expect(parseTailscaleStatus("{}").state).toBe("Unknown");
});
