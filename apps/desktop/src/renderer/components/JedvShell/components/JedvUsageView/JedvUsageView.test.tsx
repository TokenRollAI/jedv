import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { LocalClient } from "../../local-client";
import { WindowChromeContext } from "../WindowChrome/context";
import { windowChromeGeometry } from "../WindowChrome/geometry";
import { JedvUsageView } from "./JedvUsageView";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});

test("counts discovered Antigravity accounts alongside Claude Code and Codex in embedded settings view", async () => {
	const client = {
		usage: {
			history: {
				query: async () => ({
					totals: {
						usd: 0,
						tokens: 0,
						cachedInput: 0,
						output: 0,
						approximate: false,
					},
					scannedFiles: 0,
					buckets: [],
					models: [],
					projects: [],
					modelDetails: {},
					projectDetails: {},
					pricingTableUpdated: "2026-01-01",
				}),
			},
			quota: {
				query: async () => [
					{
						agent: "claude",
						credentialKind: "subscription",
						accountKey: "claude-1",
						sourceLabel: "~/.claude",
						email: "user@example.com",
						plan: "Pro",
						status: "ok",
						statusDetail: null,
						windows: [],
						creditsBalance: null,
						extraUsage: null,
						selection: null,
						isDefault: true,
						fetchedAt: new Date(),
					},
					{
						agent: "agy",
						credentialKind: "subscription",
						accountKey: "agy-1",
						sourceLabel: "~/.gemini/antigravity-cli",
						email: "agy@example.com",
						plan: "Standard",
						status: "ok",
						statusDetail: null,
						windows: [],
						creditsBalance: null,
						extraUsage: null,
						selection: null,
						isDefault: false,
						fetchedAt: new Date(),
					},
				],
			},
			logins: {
				query: async () => ({
					homeDir: "/Users/test",
					claudeDefaultFingerprint: null,
					claudeDefaultEmail: null,
					claude: [
						{
							configDir: null,
							email: "user@example.com",
							credentialKind: "subscription",
							fingerprint: "fp1",
						},
					],
					codex: [],
				}),
			},
		},
	} as unknown as LocalClient;

	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);

	const screen = render(
		<QueryClientProvider client={cache}>
			<WindowChromeContext
				value={{
					...windowChromeGeometry(undefined, 1, false),
					surface: "settings",
					collapsed: false,
					notification: null,
					onExpand: () => {},
				}}
			>
				<JedvUsageView
					client={client}
					hostUrl="http://usage.fixture"
					remote={null}
					projects={[]}
					workspaces={[]}
					onOpenWorkspace={async () => {}}
					onOpenCreateWorkspace={() => {}}
					onOpenPrivateConnection={() => {}}
					onSelectLocalHost={async () => {}}
				/>
			</WindowChromeContext>
		</QueryClientProvider>,
	);

	await screen.findByText(
		/Discovered 1 Claude Code, 0 Codex, and 1 Antigravity accounts on this host/,
	);
	expect(screen.queryByRole("heading", { name: "Usage" })).toBeNull();
});
