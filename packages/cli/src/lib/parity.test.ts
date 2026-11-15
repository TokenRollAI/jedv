import { afterEach, expect, test } from "bun:test";
import { automationQuery } from "../commands/automations/helpers";
import list from "../commands/automations/list/command";
import runs from "../commands/automations/runs/command";
import ignore from "../commands/butler/ignore/command";
import inbox from "../commands/butler/inbox/command";
import readAttention from "../commands/butler/read/command";
import request from "../commands/butler/request/command";
import timeline from "../commands/mail/timeline/command";
import { withLocalHostService } from "./host/test-helpers";

let directFeature: boolean | undefined = true;
let attentionFeature: boolean | undefined = true;
const calls: Array<{ path: string; input: Record<string, unknown> }> = [];
const record =
	(path: string, output: unknown) => (input: Record<string, unknown>) => {
		calls.push({ path, input });
		return output;
	};
withLocalHostService("parity-test", {
	"team.capabilities": () => ({ protocolVersion: 1 }),
	"mail.timeline": record("mail.timeline", [{ id: "event" }]),
	"butler.capabilities": () => ({
		protocolVersion: 1,
		...(directFeature === undefined
			? {}
			: {
					features: {
						requestApproval: directFeature,
						attention: attentionFeature,
					},
				}),
	}),
	"butler.attention": record("butler.attention", {
		groups: [],
		approvals: [],
		badge: { count: 400 },
	}),
	"butler.markAttentionRead": record("butler.markAttentionRead", {
		updatedCount: 2,
		badge: { count: 399 },
	}),
	"butler.ignoreAttention": record("butler.ignoreAttention", {
		updatedCount: 1,
		disposition: "ignored",
		badge: { count: 398 },
	}),
	"butler.requestApproval": record("butler.requestApproval", {
		id: "card",
		status: "pending",
	}),
	"automations.list": record("automations.list", [
		{ id: "automation", enabled: false },
	]),
	"automations.listRuns": record("automations.listRuns", [
		{ id: "ok", status: "succeeded", error: null },
		{ id: "failed", status: "failed", error: "Unavailable agent" },
		{ id: "interrupted", status: "interrupted", error: null },
	]),
});
const ctx = { config: { organizationId: "parity-test" } },
	signal = new AbortController().signal;
afterEach(() => {
	calls.length = 0;
	directFeature = true;
	attentionFeature = true;
});
test("attention CLI uses authoritative badge and distinct read/ignore operations without a model", async () => {
	expect(
		await inbox.run({
			ctx,
			signal,
			args: {},
			options: { view: "handled", limit: 5 } as never,
		}),
	).toMatchObject({ data: { badge: { count: 400 } } });
	await readAttention.run({
		ctx,
		signal,
		args: { target: "team_attention:team:member" },
		options: {} as never,
	});
	await ignore.run({
		ctx,
		signal,
		args: { target: "alert-uuid" },
		options: { reason: "Known" } as never,
	});
	expect(calls).toEqual([
		{ path: "butler.attention", input: { view: "handled", limit: 5 } },
		{
			path: "butler.markAttentionRead",
			input: { groupKey: "team_attention:team:member" },
		},
		{
			path: "butler.ignoreAttention",
			input: { alertId: "alert-uuid", reason: "Known" },
		},
	]);
	calls.length = 0;
	attentionFeature = undefined;
	await expect(
		readAttention.run({
			ctx,
			signal,
			args: { target: "id" },
			options: {} as never,
		}),
	).rejects.toThrow("unsupported by this host");
	expect(calls).toHaveLength(0);
});
test("a missing automation procedure reports an unsupported host", async () => {
	await expect(
		automationQuery(ctx, {}, (client) =>
			client.automations.get.query({
				id: "00000000-0000-4000-8000-000000000000",
			}),
		),
	).rejects.toThrow("unsupported by this host");
});
test("timeline uses event API without mutating read or ack", async () => {
	const result = await timeline.run({
		ctx,
		signal,
		args: {},
		options: { team: "team", human: true, limit: 42 } as never,
	});
	expect(result).toEqual({ data: [{ id: "event" }] });
	expect(calls).toEqual([
		{
			path: "mail.timeline",
			input: { teamId: "team", actor: undefined, limit: 42 },
		},
	]);
});
test("automation queries preserve persisted errors and filter only on explicit errors option", async () => {
	expect(
		await list.run({ ctx, signal, args: {}, options: {} as never }),
	).toEqual({ data: [{ id: "automation", enabled: false }] });
	const input = {
		ctx,
		signal,
		args: { automationId: "id" },
		options: {} as never,
	};
	expect(await runs.run(input)).toMatchObject({
		data: [{ id: "ok" }, { id: "failed" }, { id: "interrupted" }],
	});
	expect(
		await runs.run({ ...input, options: { errors: true } as never }),
	).toMatchObject({ data: [{ id: "failed" }, { id: "interrupted" }] });
	expect(calls[1]).toEqual({
		path: "automations.listRuns",
		input: { automationId: "id" },
	});
});
test("direct approval CLI preserves request IDs and raw message without asking a model or resolving a card", async () => {
	const action = { actionType: "stopTeam", teamId: "team" };
	const options = {
		action: JSON.stringify(action),
		message: "  stop\n    team  ",
		requestId: "retry",
		thread: "thread",
	} as never;
	expect(await request.run({ ctx, signal, args: {}, options })).toMatchObject({
		data: { status: "pending" },
	});
	expect(calls).toEqual([
		{
			path: "butler.requestApproval",
			input: {
				action,
				humanText: "  stop\n    team  ",
				requestId: "retry",
				threadId: "thread",
			},
		},
	]);
	calls.length = 0;
	directFeature = undefined;
	await expect(request.run({ ctx, signal, args: {}, options })).rejects.toThrow(
		"unsupported by this host",
	);
	expect(calls).toHaveLength(0);
});
