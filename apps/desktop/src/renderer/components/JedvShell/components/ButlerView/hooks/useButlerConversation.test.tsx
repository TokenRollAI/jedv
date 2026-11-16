import { afterEach, expect, mock, test } from "bun:test";
import type { ButlerMessageShape, ButlerSendResult } from "@jedv/shared/butler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { JedvParityViewContext } from "../../../parity-types";
import { useButlerConversation } from "./useButlerConversation";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches) cache.clear();
	caches.length = 0;
});
const result = (id: string): ButlerSendResult => ({
	threadId: id,
	currentThreadId: id,
	requestId: "request",
	reply: "ok",
	approvals: [],
	degraded: false,
	reason: null,
});
function fixture(supported = true, historyByRequest = false) {
	let current = "first";
	const state = mock(async () => ({
		currentThreadId: current,
		thread: {
			id: current,
			kind: "conversation",
			title: current,
			createdAt: 1,
			updatedAt: 1,
		},
	}));
	const history = mock(
		async (_input: unknown): Promise<ButlerMessageShape[]> => [],
	);
	const send = mock(async (_input: unknown) => result(current));
	const threads = mock(async (_input: unknown) => []);
	const ai = mock(async () => ({ configured: true, maskedHint: "••1234" }));
	const context = {
		hostUrl: `http://conversation-${crypto.randomUUID()}.fixture`,
		client: {
			butler: {
				state: { query: state },
				history: { query: history },
				listApprovals: { query: async () => [] },
				listThreads: { query: threads },
				sendMessage: { mutate: send },
			},
			aiSettings: { get: { query: ai } },
		},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const hook = renderHook(
		() => {
			const value = useButlerConversation({
				context,
				connected: true,
				supported,
				active: true,
				historyOpen: true,
				historyByRequest,
			});
			// Track the history fields consumed by ButlerChat during render.
			if (historyByRequest) {
				void value.history.data;
				void value.history.status;
			}
			return value;
		},
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={cache}>{children}</QueryClientProvider>
			),
		},
	);
	return {
		...hook,
		context,
		cache,
		state,
		history,
		send,
		threads,
		ai,
		setCurrent: (id: string) => {
			current = id;
		},
	};
}
test("idle follows the Host pointer; drafts and history stay pinned and are restored by thread", async () => {
	const f = fixture();
	await waitFor(() => expect(f.result.current.key).toBe("thread:first"));
	expect(f.threads).toHaveBeenCalledWith({ limit: 50, includeAudit: false });
	f.setCurrent("second");
	await act(async () => {
		await f.result.current.state.refetch();
	});
	await waitFor(() => expect(f.result.current.key).toBe("thread:second"));
	act(() => f.result.current.setDraft("  中文草稿\n    原缩进"));
	f.setCurrent("third");
	await act(async () => {
		await f.result.current.state.refetch();
	});
	expect(f.result.current.key).toBe("thread:second");
	expect(f.result.current.draft.text).toBe("  中文草稿\n    原缩进");
	act(() => f.result.current.choose("thread:first"));
	await act(async () => {
		await f.result.current.state.refetch();
	});
	expect(f.result.current.key).toBe("thread:first");
	act(() => f.result.current.choose("thread:second"));
	expect(f.result.current.draft.text).toBe("  中文草稿\n    原缩进");
	act(() => f.result.current.backToCurrent());
	expect(f.result.current.key).toBe("thread:third");
	expect(f.send).not.toHaveBeenCalled();
});
test("a new topic may start while the old one is in flight; its late result cannot steal selection", async () => {
	const f = fixture();
	await waitFor(() => expect(f.result.current.key).toBe("thread:first"));
	let complete: (value: ButlerSendResult) => void = () => {};
	const old = new Promise<ButlerSendResult>((resolve) => {
		complete = resolve;
	});
	f.send.mockImplementationOnce(async () => {
		f.setCurrent("old-topic");
		return old;
	});
	f.send.mockImplementationOnce(async () => {
		f.setCurrent("new-topic");
		return result("new-topic");
	});
	act(() => f.result.current.newTopic());
	act(() => f.result.current.setDraft("  First\n    indentation"));
	let first: Promise<void> = Promise.resolve();
	act(() => {
		first = f.result.current.send();
	});
	expect(f.result.current.draft.pending).toBe(true);
	act(() => f.result.current.newTopic());
	expect(f.result.current.draft.pending).toBe(false);
	act(() => f.result.current.setDraft("Second"));
	await act(async () => {
		await f.result.current.send();
	});
	expect(f.result.current.key).toBe("thread:new-topic");
	await act(async () => {
		complete(result("old-topic"));
		await first;
	});
	expect(f.result.current.key).toBe("thread:new-topic");
	expect(f.send.mock.calls[0]?.[0]).toMatchObject({
		newTopic: true,
		humanText: "  First\n    indentation",
	});
	expect(f.send.mock.calls[0]?.[0]).not.toHaveProperty("threadId");
	expect(
		f.history.mock.calls.some(
			([input]) => (input as { threadId: string }).threadId === "new-topic",
		),
	).toBe(true);
});
test("uncertain retries retain the original request and payload, including a history thread", async () => {
	const f = fixture();
	await waitFor(() => expect(f.result.current.key).toBe("thread:first"));
	f.send.mockImplementationOnce(async () => {
		throw Error("offline");
	});
	act(() => f.result.current.choose("thread:history"));
	act(() => f.result.current.setDraft("  keep exact  "));
	await act(async () => {
		await f.result.current.send();
	});
	expect(f.result.current.draft.failed).toBe(true);
	const original = f.send.mock.calls[0]?.[0];
	act(() => f.result.current.setDraft("different"));
	expect(f.result.current.draft.text).toBe("  keep exact  ");
	f.setCurrent("external-new-topic");
	f.send.mockImplementationOnce(async () => result("history"));
	await act(async () => {
		await f.result.current.send();
	});
	expect(f.send.mock.calls[1]?.[0]).toEqual(original);
	expect(original).toMatchObject({
		threadId: "history",
		humanText: "  keep exact  ",
		newTopic: false,
	});
	expect(f.result.current.key).toBe("thread:history");
	expect(f.result.current.backAvailable).toBe(true);
});
test("old Hosts without conversationState do not receive state, history, send or AI queries", async () => {
	const f = fixture(false);
	await act(async () => {});
	expect(f.result.current.unavailable).toBe(true);
	act(() => f.result.current.setDraft("text"));
	await act(async () => {
		await f.result.current.send();
	});
	for (const query of [f.state, f.history, f.send, f.threads, f.ai])
		expect(query).not.toHaveBeenCalled();
});
test("a confirmed send is not offered as an uncertain retry when a refresh fails", async () => {
	const f = fixture();
	await waitFor(() => expect(f.result.current.key).toBe("thread:first"));
	act(() => f.result.current.setDraft("Confirmed"));
	f.send.mockImplementationOnce(async () => {
		f.state.mockImplementation(async () => {
			throw Error("offline after send");
		});
		return result("first");
	});
	await act(async () => {
		await f.result.current.send();
	});
	expect(f.result.current.draft.failed).toBe(false);
	expect(f.result.current.draft.request).toBeNull();
	expect(f.result.current.draft.text).toBe("");
	expect(f.send).toHaveBeenCalledTimes(1);
});
test("draft capacity stays bounded without evicting unsent instructions", async () => {
	const f = fixture();
	await waitFor(() => expect(f.result.current.key).toBe("thread:first"));
	for (let n = 0; n < 32; n++) {
		act(() => f.result.current.choose(`thread:history-${n}`));
		act(() => f.result.current.setDraft(`Draft ${n}`));
	}
	const last = f.result.current.key;
	act(() => f.result.current.newTopic());
	expect(f.result.current.key).toBe(last);
	expect(f.result.current.capacityError).toBe(true);
	expect(f.result.current.drafts.size).toBe(32);
	expect(f.result.current.drafts.get("thread:history-0")?.text).toBe("Draft 0");
});

test("new topic reads live tool progress by its own request before the send completes", async () => {
	const f = fixture(true, true);
	await waitFor(() => expect(f.result.current.key).toBe("thread:first"));
	let complete: (result: ButlerSendResult) => void = () => {};
	const pending = new Promise<ButlerSendResult>((resolve) => {
		complete = resolve;
	});
	let status = "running";
	f.history.mockImplementation(async (input) => {
		const requestId = (input as { requestId?: string }).requestId;
		if (!requestId) return [];
		const tool: ButlerMessageShape = {
			id: "tool-1",
			threadId: "accepted-thread",
			requestId,
			role: "tool",
			content: JSON.stringify({ version: 1, tool: "listProjects", status }),
			createdAt: 1,
		};
		return [tool, { ...tool, id: "unrelated", requestId: "someone-else" }];
	});
	f.send.mockImplementationOnce(async () => pending);
	act(() => f.result.current.newTopic());
	act(() => f.result.current.setDraft("Inspect projects"));
	let sending: Promise<void> = Promise.resolve();
	act(() => {
		sending = f.result.current.send();
	});
	const requestId = f.result.current.draft.request?.requestId;
	if (!requestId) throw new Error("Missing request ID");
	await act(async () => {
		await f.result.current.history.refetch();
	});
	await waitFor(() => expect(f.result.current.history.data).toHaveLength(1));
	expect(f.result.current.history.data?.[0]?.id).toBe("tool-1");
	expect(f.result.current.draft.pending).toBe(true);
	expect(f.result.current.key.startsWith("new:")).toBe(true);
	expect(f.history.mock.calls.at(-1)?.[0]).toEqual({ requestId, limit: 100 });
	status = "failed";
	await act(async () => {
		await f.result.current.history.refetch();
	});
	await waitFor(() =>
		expect(f.result.current.history.data?.[0]?.content).toContain('"failed"'),
	);
	expect(f.send).toHaveBeenCalledTimes(1);
	await act(async () => {
		complete(result("accepted-thread"));
		await sending;
	});
	expect(f.result.current.key).toBe("thread:accepted-thread");
});
