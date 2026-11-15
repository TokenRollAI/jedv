import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { LocalClient } from "../../local-client";
import { JedvChangesView } from "./JedvChangesView";

afterEach(cleanup);
test("plain folder changes display an empty state without mounting Git controls or querying Git", async () => {
	const git = mock(async () => {
		throw new Error("Git must remain disabled");
	});
	const client = {
		workspace: {
			get: {
				query: async () => ({
					id: "folder",
					worktreePath: "/fixture/plain",
					vcsKind: "none",
					capabilities: { git: false, pullRequests: false, worktrees: false },
				}),
			},
		},
		git: { getStatus: { query: git } },
	} as unknown as LocalClient;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={cache}>
			<JedvChangesView
				client={client}
				hostUrl="http://folder.invalid"
				workspaceId="folder"
				active
				onOpenFile={() => {}}
			/>
		</QueryClientProvider>,
	);
	await screen.findByText(
		"Git features are unavailable here. Terminals and files remain available.",
	);
	expect(git).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Commit" })).toBeNull();
	cleanup();
	cache.clear();
});
