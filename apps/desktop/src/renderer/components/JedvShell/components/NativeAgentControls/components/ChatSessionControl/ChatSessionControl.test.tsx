import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { LocalClient } from "../../../../local-client";
import { createLocalPromptDraft } from "../LocalPromptComposer";
import { ChatSessionControl } from "./ChatSessionControl";

afterEach(cleanup);

test("renders session history and approvals above prompt composer", async () => {
	const client = {
		sessions: {
			read: {
				query: async () => ({
					ok: true,
					envelopes: [
						{
							v: 1,
							sessionId: "chat-1",
							ts: 1,
							cursor: { epoch: "1", seq: 1 },
							event: {
								type: "item",
								turnId: "turn-1",
								item: {
									id: "msg-1",
									kind: "agent_message",
									status: "completed",
									startedAtMs: 1,
									text: "History item from assistant",
								},
							},
						},
						{
							v: 1,
							sessionId: "chat-1",
							ts: 2,
							cursor: { epoch: "1", seq: 2 },
							event: {
								type: "item",
								turnId: "turn-1",
								item: {
									id: "apr-1",
									kind: "approval_request",
									title: "Run tests?",
									status: "pending",
									startedAtMs: 2,
								},
							},
						},
					],
				}),
			},
			get: {
				query: async () => ({
					live: true,
					session: {
						sessionId: "chat-1",
						harness: "claude-code",
						title: "Test Chat",
						status: "idle",
					},
				}),
			},
		},
		filesystem: {
			searchFiles: { query: async () => [] },
		},
	} as unknown as LocalClient;
	const draft = createLocalPromptDraft();
	const query = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={query}>
			<ChatSessionControl
				client={client}
				hostUrl="http://fixture.invalid"
				workspaceId="w1"
				sessionId="chat-1"
				title="Test Chat"
				turnId={null}
				working={false}
				fullHeight
				draft={draft}
				onRefresh={async () => {}}
			/>
		</QueryClientProvider>,
	);
	const history = await view.findByText("History item from assistant");
	const approval = view.getByText("Run tests?");
	const sendButton = view.getByRole("button", { name: "Send" });
	await waitFor(() => {
		expect(
			history.compareDocumentPosition(sendButton) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			approval.compareDocumentPosition(sendButton) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
	draft.attachments.clear();
	query.clear();
});
