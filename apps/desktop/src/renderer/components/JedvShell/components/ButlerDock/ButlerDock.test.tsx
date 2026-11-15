import { afterEach, expect, mock, test } from "bun:test";
import type { ButlerApprovalShape } from "@jedv/shared/butler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { LocalClient } from "../../local-client";
import type { JedvParityViewContext } from "../../parity-types";
import { ButlerDock } from "./ButlerDock";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
test("dock reads alerts without issuing writes; uncertain approval locks until explicit refresh", async () => {
	const approval = {
		id: "approval",
		threadId: "thread",
		actionType: "stopTeam",
		targetId: "team",
		summary: "Stop workers",
		payload: { actionType: "stopTeam", teamId: "team" },
		payloadHash: "a".repeat(64),
		status: "pending",
		createdAt: 1,
		expiresAt: Date.now() + 600_000,
		resolvedAt: null,
		error: null,
	} as ButlerApprovalShape;
	const resolve = mock(async (_input: unknown) => {
		throw new Error("unknown network result");
	});
	const read = mock(async () => {}),
		send = mock(async () => {});
	const client = {
		butler: {
			capabilities: { query: async () => ({ protocolVersion: 1 }) },
			inbox: {
				query: async () => ({
					alerts: [
						{
							id: "alert",
							dedupeKey: "mail",
							kind: "mail_unacked",
							subject: "Mail warning",
							body: "Unread evidence",
							teamId: "team",
							createdAt: 1,
							readAt: null,
						},
					],
					approvals: [approval],
				}),
			},
			listThreads: { query: async () => [] },
			history: { query: async () => [] },
			listApprovals: { query: async () => [] },
			resolveApproval: { mutate: resolve },
			sendMessage: { mutate: send },
		},
		watchdog: { markRead: { mutate: read } },
		aiSettings: {
			get: { query: async () => ({ configured: false, maskedHint: null }) },
		},
	} as unknown as LocalClient;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const context = {
		client,
		hostUrl: "http://butler.fixture",
		projects: [],
		workspaces: [],
	} as unknown as JedvParityViewContext;
	const screen = render(
		<QueryClientProvider client={cache}>
			<ButlerDock
				context={context}
				teams={[]}
				connected
				onSettings={() => {}}
			/>
		</QueryClientProvider>,
	);
	expect(screen.queryByRole("tab", { name: /^Inbox/ })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /^Butler/ }));
	await screen.findByText(
		"DeepSeek is not configured. Status and Inbox still work.",
	);
	expect(send).not.toHaveBeenCalled();
	expect(resolve).not.toHaveBeenCalled();
	expect(read).not.toHaveBeenCalled();
	fireEvent.mouseDown(screen.getByRole("tab", { name: /^Inbox/ }), {
		button: 0,
		ctrlKey: false,
	});
	const confirm = await screen.findByRole("button", { name: "Confirm stop" });
	fireEvent.click(confirm);
	await screen.findByText(
		"The result is uncertain. Refresh before deciding again.",
	);
	expect(resolve).toHaveBeenCalledWith({
		approvalId: "approval",
		payloadHash: "a".repeat(64),
		decision: "approve",
	});
	expect((confirm as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(confirm);
	expect(resolve).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect((confirm as HTMLButtonElement).disabled).toBe(false),
	);
	expect(read).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
});
