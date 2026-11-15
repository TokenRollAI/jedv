import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { LocalClient } from "../../../../local-client";
import { AutomationRuns } from "./AutomationRuns";

afterEach(cleanup);
test("run output handles real approval items, interrupts only on click, and opens no virtual PTY", async () => {
	const run = {
		id: "run-fixture",
		automationId: "automation-fixture",
		status: "awaiting-approval",
		trigger: "manual",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		finishedAt: null,
		scheduledAt: null,
		workspaceId: "workspace-fixture",
		terminalId: "virtual-chat-terminal",
		chatSessionId: "chat-fixture",
		nativeSessionId: "native-fixture",
		error: null,
	};
	const approve = mock(async () => ({ ok: true }));
	const interrupt = mock(async () => ({ ok: true }));
	const open = mock(async () => {});
	const client = {
		automations: { listRuns: { query: async () => [run] } },
		sessions: {
			read: {
				query: async () => ({
					ok: true,
					envelopes: [
						{
							v: 1,
							sessionId: "chat-fixture",
							cursor: { epoch: "fixture", seq: 1 },
							ts: 1,
							event: {
								type: "item",
								turnId: "turn-fixture",
								item: {
									id: "approval-fixture",
									kind: "approval_request",
									targetItemId: null,
									title: "Read fixture file",
									status: "pending",
									startedAtMs: 1,
									options: [
										{
											optionId: "allow-fixture",
											label: "Allow fixture",
											kind: "allow_once",
										},
									],
								},
							},
						},
					],
					nextBefore: null,
				}),
			},
			get: { query: async () => ({ live: true, session: {} }) },
			respondApproval: { mutate: approve },
			interrupt: { mutate: interrupt },
		},
	} as unknown as LocalClient;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={queries}>
			<AutomationRuns
				client={client}
				hostUrl="http://fixture.invalid"
				automationId="automation-fixture"
				onOpenWorkspace={open}
			/>
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: /Awaiting approval/ }),
		).toBeTruthy(),
	);
	expect(approve).not.toHaveBeenCalled();
	expect(interrupt).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: /Awaiting approval/ }));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Allow fixture" })).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Allow fixture" }));
	await waitFor(() =>
		expect(approve).toHaveBeenCalledWith({
			workspaceId: "workspace-fixture",
			sessionId: "chat-fixture",
			itemId: "approval-fixture",
			decision: { type: "option", optionId: "allow-fixture" },
		}),
	);
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Interrupt" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
	await waitFor(() =>
		expect(interrupt).toHaveBeenCalledWith({
			workspaceId: "workspace-fixture",
			sessionId: "chat-fixture",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
	expect(open).toHaveBeenCalledWith("workspace-fixture", null);
	queries.clear();
});
