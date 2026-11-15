import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { JedvParityViewContext } from "../../../../parity-types";
import { ButlerChat } from "./ButlerChat";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches) cache.clear();
	caches.length = 0;
});
test("the main chat uses PromptInput, real Markdown, History selection and unchanged uncertain retries", async () => {
	const send = mock(async (_input: unknown): Promise<never> => {
		throw Error("offline");
	});
	const history = mock(async ({ threadId }: { threadId: string }) =>
		threadId === "current"
			? [
					{
						id: "message",
						threadId,
						requestId: "turn",
						role: "assistant",
						content: "## Real Markdown\n\n**Done**",
						createdAt: 1,
					},
				]
			: [],
	);
	const context = {
		hostUrl: "http://chat-ui.fixture",
		workspaces: [],
		projects: [],
		client: {
			butler: {
				state: {
					query: async () => ({ currentThreadId: "current", thread: null }),
				},
				listThreads: {
					query: async () => [
						{
							id: "old",
							kind: "conversation",
							title: "Older conversation",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				history: { query: history },
				listApprovals: { query: async () => [] },
				sendMessage: { mutate: send },
			},
			aiSettings: {
				get: { query: async () => ({ configured: true, maskedHint: null }) },
			},
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
	const screen = render(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<ButlerChat
					context={context}
					connected
					supported
					active
					teams={[]}
					actionable={7}
					pending={false}
					blocked={new Set()}
					onResolve={() => {}}
					onRefresh={async () => {}}
					onSettings={() => {}}
					onClose={() => {}}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	await screen.findByRole("heading", { name: "Real Markdown" });
	expect(screen.queryByRole("combobox")).toBeNull();
	expect(screen.container.textContent).not.toContain("**Done**");
	const input = screen.getByRole("textbox", {
		name: "Ask Butler…",
	}) as HTMLTextAreaElement;
	fireEvent.change(input, { target: { value: "  human text\n    untouched" } });
	fireEvent.click(screen.getByRole("button", { name: "History" }));
	fireEvent.click(
		await screen.findByRole("option", { name: "Older conversation" }),
	);
	await waitFor(() => expect(input.value).toBe(""));
	fireEvent.click(
		screen.getByRole("button", { name: "Back to current conversation" }),
	);
	await waitFor(() => expect(input.value).toBe("  human text\n    untouched"));
	fireEvent.click(screen.getByRole("button", { name: "Send" }));
	await screen.findByText(
		"The result is uncertain. Retry this message with the same request ID.",
	);
	expect(input.value).toBe("  human text\n    untouched");
	expect(input.readOnly).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
	expect(send.mock.calls[0]?.[0]).toMatchObject({
		threadId: "current",
		humanText: "  human text\n    untouched",
	});
	fireEvent.click(screen.getByRole("button", { name: "New topic" }));
	await waitFor(() => expect(input.readOnly).toBe(false));
	expect(input.value).toBe("");
	expect(
		screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
	).toBe(true);
});
