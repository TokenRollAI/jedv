import { expect, test } from "bun:test";
import type { AgentIslandApprovalEvent } from "shared/types/agent-island";
import type { LocalClient } from "../../local-client";
import { executeIslandApproval } from "./approval";

const event: AgentIslandApprovalEvent = {
	actionId: "action",
	hostId: "https://host.ts.net",
	workspaceId: "workspace",
	provider: "codex",
	nativeSessionId: "native",
	profileHash: "profile",
	expectedLeaseEpoch: 4,
	requestId: "request",
	decision: "accept",
};
const base = {
	workspaceId: "workspace",
	provider: "codex",
	nativeSessionId: "native",
	profileHash: "profile",
	leaseEpoch: 4,
	activeWriter: "control",
	pendingApprovals: [{ requestId: "request", method: "command" }],
};
function clientFor(
	query: () => Promise<unknown>,
	write: (input: unknown) => Promise<unknown>,
) {
	return {
		terminalAgents: {
			queryNativeSession: { query },
			controlNativeSession: { mutate: write },
		},
	} as unknown as LocalClient;
}

test("Island approval revalidates identity and writes with the same authenticated client and epoch", async () => {
	let writes = 0;
	let completed: unknown;
	let refreshed = false;
	const client = clientFor(
		async () => base,
		async (input) => {
			writes++;
			expect(input).toMatchObject({
				nativeSessionId: "native",
				expectedLeaseEpoch: 4,
				action: { type: "approve", requestId: "request", decision: "accept" },
			});
		},
	);
	expect(
		await executeIslandApproval(event, {
			connection: () => ({ hostId: event.hostId, client }),
			complete: async (value) => {
				completed = value;
			},
			refresh: async () => {
				refreshed = true;
			},
		}),
	).toBe(true);
	expect(writes).toBe(1);
	expect(completed).toEqual({ actionId: "action", ok: true });
	expect(refreshed).toBe(true);
});

test("stale host, profile, epoch, CLI ownership or withdrawn approval can never be approved", async () => {
	for (const patch of [
		{ profileHash: "other" },
		{ leaseEpoch: 5 },
		{ activeWriter: "cli" },
		{ nativeSessionId: "other" },
		{ pendingApprovals: [] },
	]) {
		let writes = 0;
		let completed: unknown;
		const client = clientFor(
			async () => ({ ...base, ...patch }),
			async () => {
				writes++;
			},
		);
		expect(
			await executeIslandApproval(event, {
				connection: () => ({ hostId: event.hostId, client }),
				complete: async (value) => {
					completed = value;
				},
				refresh: async () => {},
			}),
		).toBe(false);
		expect(writes).toBe(0);
		expect(completed).toEqual({ actionId: "action", ok: false });
	}
	let host = event.hostId;
	let writes = 0;
	const client = clientFor(
		async () => {
			host = "https://other.ts.net";
			return base;
		},
		async () => {
			writes++;
		},
	);
	await executeIslandApproval(event, {
		connection: () => ({ hostId: host, client }),
		complete: async () => {},
		refresh: async () => {},
	});
	expect(writes).toBe(0);
});
