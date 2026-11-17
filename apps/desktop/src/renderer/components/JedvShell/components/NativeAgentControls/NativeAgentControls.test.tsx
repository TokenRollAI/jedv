import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { LocalClient } from "../../local-client";
import { NativeAgentControls } from "./NativeAgentControls";

afterEach(cleanup);

test("recognizes terminal binding via terminalAgents.get and definitionId preset fallback", async () => {
	const client = {
		terminalAgents: {
			controlCapabilities: { query: async () => [] },
			listByWorkspace: { query: async () => [] },
			get: {
				query: async () => ({
					terminalId: "term-1",
					workspaceId: "w1",
					agentId: "custom-claude",
					definitionId: "cfg-1",
					agentSessionId: "native-1",
					lastEventType: "Stop",
					lastEventAt: 1,
					startedAt: 1,
				}),
			},
			queryNativeSession: {
				query: async () => ({
					source: "native-session",
					supported: true,
					controlMode: "quiesced-resume",
					verification: "verified",
					workspaceId: "w1",
					provider: "claude",
					profileHash: "h1",
					nativeSessionId: "native-1",
					cwd: "/tmp/repo",
					terminalId: "term-1",
					chatSessionId: null,
					activeWriter: "cli",
					leaseEpoch: 1,
					turnState: "idle",
					turnId: null,
					pendingApprovals: [],
				}),
			},
		},
		settings: {
			agentConfigs: {
				list: {
					query: async () => [
						{
							id: "cfg-1",
							presetId: "claude",
							label: "My Claude",
							iconId: null,
						},
					],
				},
			},
		},
	} as unknown as LocalClient;
	const query = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={query}>
			<NativeAgentControls
				inline
				client={client}
				hostUrl="http://fixture.invalid"
				workspaceId="w1"
				terminalId="term-1"
			/>
		</QueryClientProvider>,
	);
	await waitFor(() => expect(view.getByText("Claude Code")).toBeTruthy());
	expect(
		view.queryByText(
			"Select an agent terminal to inspect or control its current session.",
		),
	).toBeNull();
	query.clear();
});
