import { afterEach, expect, test } from "bun:test";
import ack from "../commands/mail/ack/command";
import read from "../commands/mail/read/command";
import init from "../commands/team/init/command";
import spawn from "../commands/team/spawn/command";
import start from "../commands/team/start/command";
import { withLocalHostService } from "./host/test-helpers";
import { teamworkClient } from "./teamwork";

let protocol = 1;
let startFeature: boolean | undefined;
let startCallerFeature: boolean | undefined;
const calls: Array<{ path: string; input: Record<string, unknown> }> = [];
const procedure = (path: string) => (input: Record<string, unknown>) => {
	calls.push({ path, input });
	return { id: "result" };
};
withLocalHostService("teamwork-test", {
	"team.capabilities": () => ({
		protocolVersion: protocol,
		...(startFeature === undefined
			? {}
			: { features: { start: startFeature, startCaller: startCallerFeature } }),
	}),
	"team.start": procedure("team.start"),
	"team.init": procedure("team.init"),
	"team.spawn": procedure("team.spawn"),
	"mail.read": procedure("mail.read"),
	"mail.ack": procedure("mail.ack"),
});
const ctx = { config: { organizationId: "teamwork-test" } };
const signal = new AbortController().signal;
afterEach(() => {
	protocol = 1;
	startFeature = undefined;
	startCallerFeature = undefined;
	calls.length = 0;
});

test("team init sends actual terminal identity and leader metadata", async () => {
	await init.run({
		ctx,
		signal,
		args: {} as never,
		options: {
			name: "Team",
			goal: "Goal",
			callerWorkspace: "ws",
			terminal: "term",
			launch: "caller-launch",
		} as never,
	});
	expect(calls).toEqual([
		{
			path: "team.init",
			input: {
				actor: {
					workspaceId: "ws",
					terminalId: "term",
					launchId: "caller-launch",
				},
				name: "Team",
				goal: "Goal",
				leaderName: "leader",
			},
		},
	]);
});
test("spawn preserves retry key, existing target workspace, model, effort and mode", async () => {
	await spawn.run({
		ctx,
		signal,
		args: {} as never,
		options: {
			human: true,
			team: "team",
			name: "worker",
			agent: "codex",
			prompt: "task",
			workspace: "target",
			operationId: "retry",
			model: "model",
			effort: "high",
			mode: "safe",
		} as never,
	});
	expect(calls[0]).toMatchObject({
		path: "team.spawn",
		input: {
			teamId: "team",
			name: "worker",
			workspaceId: "target",
			operationId: "retry",
			model: "model",
			effort: "high",
			mode: "safe",
			newWorktree: false,
		},
	});
});
test("read never calls ack; ack is an explicit separate command", async () => {
	const options = { team: "team", human: true, member: "worker" } as never;
	await read.run({ ctx, signal, options, args: { deliveryId: "delivery" } });
	expect(calls.map((x) => x.path)).toEqual(["mail.read"]);
	await ack.run({ ctx, signal, options, args: { deliveryId: "delivery" } });
	expect(calls.map((x) => x.path)).toEqual(["mail.read", "mail.ack"]);
});
test("an incompatible host protocol is rejected before any Team mutation", async () => {
	protocol = 0;
	await expect(teamworkClient(ctx, { human: true })).rejects.toThrow(
		"does not support this Teamwork protocol",
	);
	expect(calls).toEqual([]);
});

test("new task start preserves raw prompt and operationId only after the optional start feature is verified", async () => {
	startFeature = true;
	await start.run({
		ctx,
		signal,
		args: {} as never,
		options: {
			human: true,
			workspace: "folder-ws",
			agent: "claude",
			operationId: "start-once",
			prompt: "  keep indentation\n    next line\n",
			name: "Task",
			model: "model",
			effort: "high",
			mode: "safe",
		} as never,
	});
	expect(calls).toEqual([
		{
			path: "team.start",
			input: {
				workspaceId: "folder-ws",
				agent: "claude",
				operationId: "start-once",
				prompt: "  keep indentation\n    next line\n",
				name: "Task",
				model: "model",
				effort: "high",
				mode: "safe",
			},
		},
	]);
});
test("start forwards calling identity separately from the target workspace", async () => {
	startFeature = true;
	startCallerFeature = true;
	await start.run({
		ctx,
		signal,
		args: {} as never,
		options: {
			callerWorkspace: "calling-workspace",
			terminal: "calling-terminal",
			launch: "calling-launch",
			workspace: "target-workspace",
			agent: "codex",
			operationId: "native-start",
			prompt: "new task",
		} as never,
	});
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		path: "team.start",
		input: {
			workspaceId: "target-workspace",
			actor: {
				workspaceId: "calling-workspace",
				terminalId: "calling-terminal",
				launchId: "calling-launch",
			},
		},
	});
});
test("native start fails closed against an old Host that cannot check caller membership", async () => {
	startFeature = true;
	await expect(
		start.run({
			ctx,
			signal,
			args: {} as never,
			options: {
				callerWorkspace: "calling-workspace",
				terminal: "calling-terminal",
				workspace: "target-workspace",
				agent: "codex",
				operationId: "native-start",
				prompt: "new task",
			} as never,
		}),
	).rejects.toThrow("cannot check existing Team membership");
	expect(calls).toHaveLength(0);
});
test("an old protocol 1 host without start feature is rejected before launching a task", async () => {
	await expect(
		start.run({
			ctx,
			signal,
			args: {} as never,
			options: {
				workspace: "folder-ws",
				agent: "claude",
				operationId: "start-once",
				prompt: "task",
			} as never,
		}),
	).rejects.toThrow("unsupported by this host");
	expect(calls).toEqual([]);
});
