import { afterEach, expect, test } from "bun:test";
import approvals from "../commands/butler/approvals/command";
import ask from "../commands/butler/ask/command";
import history from "../commands/butler/history/command";
import list from "../commands/butler/list/command";
import state from "../commands/butler/state/command";
import { withLocalHostService } from "./host/test-helpers";

let feature = true;
const calls: Array<{ path: string; input: Record<string, unknown> }> = [];
const record = (path: string) => (input: Record<string, unknown>) => {
	calls.push({ path, input });
	return { id: "result" };
};
withLocalHostService("conversation-cli", {
	"butler.capabilities": () => ({
		protocolVersion: 1,
		features: { conversationState: feature },
	}),
	"butler.state": record("state"),
	"butler.sendMessage": record("send"),
	"butler.history": record("history"),
	"butler.listThreads": record("list"),
	"butler.listApprovals": record("approvals"),
});
const ctx = { config: { organizationId: "conversation-cli" } },
	signal = new AbortController().signal;
afterEach(() => {
	feature = true;
	calls.length = 0;
});
test("CLI sends to host current by default, preserves raw text and IDs, and explicitly requests new topic", async () => {
	await state.run({
		ctx,
		signal,
		args: {},
		options: { preferredThread: "preferred" } as never,
	});
	await ask.run({
		ctx,
		signal,
		args: {},
		options: {
			message: "  完整\n    text  ",
			requestId: "retry",
			newTopic: true,
			approvalId: "approval",
			groupKey: "group:key",
		} as never,
	});
	expect(calls).toEqual([
		{ path: "state", input: { preferredThreadId: "preferred" } },
		{
			path: "send",
			input: {
				humanText: "  完整\n    text  ",
				requestId: "retry",
				newTopic: true,
				context: { approvalId: "approval", groupKey: "group:key" },
			},
		},
	]);
	await history.run({
		ctx,
		signal,
		args: {},
		options: { limit: 100 } as never,
	});
	expect(calls.at(-1)).toEqual({ path: "history", input: { limit: 100 } });
});
test("CLI includes audit only on request and filters a true approval ID", async () => {
	await list.run({
		ctx,
		signal,
		args: {},
		options: { limit: 50, includeAudit: true } as never,
	});
	await approvals.run({
		ctx,
		signal,
		args: {},
		options: {
			approval: "card",
			thread: "thread",
			status: "all",
			limit: 10,
		} as never,
	});
	expect(calls).toEqual([
		{ path: "list", input: { limit: 50, includeAudit: true } },
		{
			path: "approvals",
			input: {
				approvalId: "card",
				threadId: "thread",
				status: "all",
				limit: 10,
			},
		},
	]);
});
test("CLI never guesses recent state on an old host and rejects conflicting send options", async () => {
	feature = false;
	await expect(
		state.run({ ctx, signal, args: {}, options: {} as never }),
	).rejects.toThrow("unsupported by this host");
	await expect(
		ask.run({ ctx, signal, args: {}, options: { message: "New" } as never }),
	).rejects.toThrow("unsupported by this host");
	expect(calls).toHaveLength(0);
	feature = true;
	await expect(
		ask.run({
			ctx,
			signal,
			args: {},
			options: { message: "New", newTopic: true, thread: "old" } as never,
		}),
	).rejects.toThrow("cannot specify --thread");
	expect(calls).toHaveLength(0);
});
