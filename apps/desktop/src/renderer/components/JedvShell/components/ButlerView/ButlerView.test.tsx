import { afterEach, expect, mock, test } from "bun:test";
import type {
	AttentionGroupShape,
	AttentionSourceTarget,
} from "@jedv/shared/butler-attention";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useButlerInbox } from "../../hooks/useButlerInbox";
import type { JedvParityViewContext } from "../../parity-types";
import { ButlerView } from "./ButlerView";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
async function createHarness() {
	let readAt: number | null = null,
		ignoredAt: number | null = null;
	let ignoreReason: string | null = null;
	let reopened = false;
	let severity: "normal" | "high" = "normal";
	const source: AttentionSourceTarget = {
		kind: "mail_delivery",
		teamId: "team",
		memberId: "member",
		projectId: null,
		workspaceId: null,
		terminalId: null,
		terminalLive: false,
		fallback: "team",
		mailDeliveryId: "delivery",
		automationId: null,
		automationRunId: null,
	};
	const group = (): AttentionGroupShape => ({
		groupKey: "mail:team:member",
		kind: "mail_unacked",
		severity,
		subject: "Mail needs attention",
		body: "Evidence",
		disposition: ignoredAt ? "ignored" : "open",
		unread: readAt == null,
		activeCount: 3,
		totalCount: 3,
		firstCreatedAt: 1,
		latestCreatedAt: 2,
		source,
		items: [
			{
				id: "alert",
				groupKey: "mail:team:member",
				dedupeKey: "mail",
				kind: "mail_unacked",
				severity,
				subject: "Mail needs attention",
				body: "Evidence",
				teamId: "team",
				projectId: null,
				workspaceId: null,
				terminalId: null,
				memberId: "member",
				mailDeliveryId: "delivery",
				automationId: null,
				automationRunId: null,
				createdAt: 1,
				readAt,
				ignoredAt,
				ignoreReason,
				resolvedAt: null,
				source,
			},
		],
	});
	const approval = {
		id: "approval",
		threadId: "thread",
		actionType: "stopTeam",
		targetId: "team",
		summary: "Stop workers",
		payload: { actionType: "stopTeam", teamId: "team" },
		payloadHash: "a".repeat(64),
		status: "pending",
		createdAt: 2,
		expiresAt: Date.now() + 600_000,
		resolvedAt: null,
		error: null,
	};
	const attention = mock(async (input: { view: string }) => {
		const current = group();
		if (reopened) {
			current.disposition = "open";
			current.unread = true;
			current.activeCount = 4;
			current.totalCount = 4;
			const first = current.items[0];
			if (first)
				current.items.unshift({
					...first,
					id: "new-alert",
					dedupeKey: "new-mail",
					readAt: null,
					ignoredAt: null,
					ignoreReason: null,
				});
		}
		const open = !ignoredAt || reopened;
		return {
			badge: { pendingApprovals: 37, unreadHighFaultGroups: 0, count: 37 },
			groups:
				input.view === "handled"
					? open
						? []
						: [current]
					: open
						? [current]
						: [],
			approvals: input.view === "open" ? [approval] : [],
		};
	});

	const read = mock(async (_input: unknown) => {
		readAt = 3;
		return {
			updatedCount: 3,
			badge: { pendingApprovals: 37, unreadHighFaultGroups: 0, count: 37 },
		};
	});
	const ignore = mock(async (input: { groupKey: string; reason?: string }) => {
		ignoredAt = 4;
		ignoreReason = input.reason ?? null;
		return {
			updatedCount: 3,
			disposition: "ignored",
			badge: { pendingApprovals: 37, unreadHighFaultGroups: 0, count: 37 },
		};
	});
	const resolve = mock(async (_input: unknown) => {
		throw new Error("unknown");
	});
	const ai = mock(async () => ({ configured: false, maskedHint: null })),
		send = mock(async () => ({})),
		legacy = mock(async () => ({})),
		ack = mock(async () => ({}));
	const context = {
		hostUrl: "http://butler-space.fixture",
		projects: [],
		workspaces: [],
		client: {
			butler: {
				capabilities: {
					query: async () => ({
						protocolVersion: 1,
						features: { attention: true, conversationState: true },
					}),
				},
				attention: { query: attention },
				state: { query: async () => ({ currentThreadId: null, thread: null }) },
				markAttentionRead: { mutate: read },
				ignoreAttention: { mutate: ignore },
				inbox: { query: legacy },
				resolveApproval: { mutate: resolve },
				listThreads: { query: async () => [] },
				history: { query: async () => [] },
				sendMessage: { mutate: send },
			},
			watchdog: { markRead: { mutate: legacy } },
			mail: { ack: { mutate: ack } },
			aiSettings: { get: { query: ai } },
		},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: 1 } });
					emit.complete();
				}),
		],
	});
	function Harness() {
		const index = useButlerInbox(context.client, context.hostUrl, true);
		return (
			<ButlerView
				context={context}
				index={index}
				teams={[]}
				connected
				onSettings={() => {}}
				onOpenTeam={() => {}}
				onOpenAutomations={() => {}}
			/>
		);
	}
	const view = render(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<Harness />
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	const screen = within(view.container);
	await screen.findByRole("button", { name: "Confirm stop" });
	return {
		screen,
		cache,
		context,
		ai,
		send,
		read,
		ignore,
		resolve,
		legacy,
		ack,
		setSeverity(value: "normal" | "high") {
			severity = value;
		},
		reopen() {
			reopened = true;
		},
	};
}

async function openDiagnostics(
	screen: Awaited<ReturnType<typeof createHarness>>["screen"],
) {
	fireEvent.click(
		await screen.findByRole("button", { name: "Internal mail diagnostics" }),
	);
	await screen.findByRole("heading", {
		name: "Mail awaiting acknowledgement: 3",
	});
}

test("attention hides normal mail diagnostics and always shows high severity", async () => {
	const { screen, cache, context, ack, setSeverity } = await createHarness();
	expect(
		screen.queryAllByRole("heading", {
			name: "Mail awaiting acknowledgement: 3",
		}).length,
	).toBe(0);
	expect(ack).not.toHaveBeenCalled();
	setSeverity("high");
	await act(async () => {
		await cache.invalidateQueries({
			queryKey: ["jedv", context.hostUrl, "butler"],
		});
	});
	await screen.findByRole("heading", {
		name: "Mail awaiting acknowledgement: 3",
	});
	setSeverity("normal");
	await act(async () => {
		await cache.invalidateQueries({
			queryKey: ["jedv", context.hostUrl, "butler"],
		});
	});
	// Retried assertions compare counts to avoid formatting the React DOM graph.
	await waitFor(() =>
		expect(
			screen.queryAllByRole("heading", {
				name: "Mail awaiting acknowledgement: 3",
			}).length,
		).toBe(0),
	);
	await openDiagnostics(screen);
	expect(ack).not.toHaveBeenCalled();
});

test("attention uses authoritative counts and read receipts without ACKing mail", async () => {
	const { screen, ai, send, read, ignore, resolve, legacy, ack } =
		await createHarness();
	await openDiagnostics(screen);
	expect(ai).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
	expect(read).not.toHaveBeenCalled();
	expect(ignore).not.toHaveBeenCalled();
	expect(resolve).not.toHaveBeenCalled();
	expect(legacy).not.toHaveBeenCalled();
	expect(screen.getByRole("tab", { name: /Pending/ }).textContent).toContain(
		"37",
	);
	fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
	await waitFor(() =>
		expect(read).toHaveBeenCalledWith({ groupKey: "mail:team:member" }),
	);
	await waitFor(() =>
		expect(
			screen.queryAllByRole("button", { name: "Mark as read" }).length,
		).toBe(0),
	);
	expect(
		screen.getByRole("heading", { name: "Mail awaiting acknowledgement: 3" }),
	).toBeTruthy();
	expect(ack).not.toHaveBeenCalled();
	fireEvent.mouseDown(screen.getByRole("tab", { name: "Processed" }), {
		button: 0,
		ctrlKey: false,
	});
	await waitFor(() =>
		expect(
			screen.queryAllByRole("heading", {
				name: "Mail awaiting acknowledgement: 3",
			}).length,
		).toBe(0),
	);
	fireEvent.mouseDown(screen.getByRole("tab", { name: /Pending/ }), {
		button: 0,
		ctrlKey: false,
	});
});

test("ignored attention remains distinct from resolved and reopens for new mail", async () => {
	const { screen, cache, context, ignore, ack, reopen } = await createHarness();
	await openDiagnostics(screen);
	fireEvent.click(await screen.findByRole("button", { name: "Ignore" }));
	const dialog = within(document.body).getByRole("dialog");
	expect(ignore).not.toHaveBeenCalled();
	fireEvent.change(
		within(dialog).getByRole("textbox", { name: "Reason (optional)" }),
		{ target: { value: "Known failure" } },
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "Ignore" }));
	await waitFor(() =>
		expect(ignore).toHaveBeenCalledWith({
			groupKey: "mail:team:member",
			reason: "Known failure",
		}),
	);
	await waitFor(() =>
		expect(within(document.body).queryAllByRole("dialog").length).toBe(0),
	);
	await waitFor(() =>
		expect(
			screen.queryAllByRole("heading", {
				name: "Mail awaiting acknowledgement: 3",
			}).length,
		).toBe(0),
	);
	expect(ack).not.toHaveBeenCalled();
	fireEvent.mouseDown(screen.getByRole("tab", { name: "Processed" }), {
		button: 0,
		ctrlKey: false,
	});
	await screen.findByText("Ignored");
	expect(screen.queryByText("Resolved")).toBeNull();
	expect(
		screen.getByRole("heading", { name: "Mail awaiting acknowledgement: 3" }),
	).toBeTruthy();
	reopen();
	await act(async () => {
		await cache.invalidateQueries({
			queryKey: ["jedv", context.hostUrl, "butler", "attention"],
		});
	});

	fireEvent.mouseDown(screen.getByRole("tab", { name: /Pending/ }), {
		button: 0,
		ctrlKey: false,
	});
	await screen.findByRole("heading", {
		name: "Mail awaiting acknowledgement: 4",
	});
	expect(screen.getByRole("button", { name: "Mark as read" })).toBeTruthy();
	expect(ack).not.toHaveBeenCalled();
});

test("failed approval cannot be repeated and AI settings load only when chat opens", async () => {
	const { screen, resolve, ai, send } = await createHarness();
	const confirm = await screen.findByRole("button", { name: "Confirm stop" });
	fireEvent.click(confirm);
	await waitFor(() =>
		expect(resolve).toHaveBeenCalledWith({
			approvalId: "approval",
			payloadHash: "a".repeat(64),
			decision: "approve",
		}),
	);
	await waitFor(() =>
		expect((confirm as HTMLButtonElement).disabled).toBe(true),
	);
	fireEvent.click(confirm);
	expect(resolve).toHaveBeenCalledTimes(1);
	expect(ai).not.toHaveBeenCalled();
	const [ask] = screen.getAllByRole("button", { name: "Ask Butler" });
	if (!ask) throw new Error("Missing Butler action");
	fireEvent.click(ask);
	await screen.findByText(
		"DeepSeek is not configured. Status and Inbox still work.",
	);
	expect(send).not.toHaveBeenCalled();
});
