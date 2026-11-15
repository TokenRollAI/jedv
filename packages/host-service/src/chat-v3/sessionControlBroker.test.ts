import { describe, expect, test } from "bun:test";
import type { SharedCodexDaemon } from "./codexDaemon";
import {
	type NativeIdentity,
	SessionControlBroker,
} from "./sessionControlBroker";

const identity: NativeIdentity = {
	workspaceId: "workspace",
	provider: "codex",
	profileHash: "profile",
	nativeSessionId: "native-thread",
};
function registered(provider: NativeIdentity["provider"] = "codex") {
	const broker = new SessionControlBroker();
	const id = { ...identity, provider };
	broker.register(id, "/tmp/workspace");
	return { broker, id };
}

describe("native session control ownership", () => {
	test("CLI must exit before claiming and stale epochs are rejected", async () => {
		const { broker, id } = registered("claude");
		const cli = broker.bindCli(id, "terminal");
		await expect(
			broker.claim(id, cli.leaseEpoch, async () => true),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const control = await broker.claim(
			id,
			cli.leaseEpoch,
			async () => false,
			async () => "chat",
		);
		expect(control.nativeSessionId).toBe(id.nativeSessionId);
		expect(control.chatSessionId).toBe("chat");
		expect(control.activeWriter).toBe("control");
		await expect(
			broker.open(id, cli.leaseEpoch, async () => "other"),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	test("all Control writes reject while CLI launch is awaiting completion", async () => {
		const { broker, id } = registered();
		const control = await broker.claim(
			id,
			broker.state(id).leaseEpoch,
			async () => false,
		);
		let finish: (id: string) => void = () => {};
		const opening = broker.open(
			id,
			control.leaseEpoch,
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		await expect(
			broker.control(id, control.leaseEpoch, {
				type: "prompt",
				text: "must not write",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			broker.withControl(id, control.leaseEpoch, async () => {}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		finish("terminal");
		expect((await opening).activeWriter).toBe("cli");
	});

	test("failed native load leaves CLI ownership and identity intact", async () => {
		const { broker, id } = registered("kimi");
		const cli = broker.bindCli(id, "terminal");
		await expect(
			broker.claim(
				id,
				cli.leaseEpoch,
				async () => false,
				async () => {
					throw new Error("Authentication required");
				},
			),
		).rejects.toThrow("Authentication required");
		expect(broker.state(id).activeWriter).toBe("cli");
		expect(broker.state(id).nativeSessionId).toBe(id.nativeSessionId);
		expect(broker.state(id).leaseEpoch).toBe(cli.leaseEpoch);
	});

	test("native CLI turns revoke Control and preserve the shared thread ID", async () => {
		const { broker, id } = registered();
		const control = await broker.claim(
			id,
			broker.state(id).leaseEpoch,
			async () => false,
		);
		broker.notification(id.workspaceId, id.profileHash, {
			method: "turn/started",
			params: { threadId: id.nativeSessionId, turn: { id: "turn" } },
		});
		expect(broker.state(id)).toMatchObject({
			activeWriter: "cli",
			turnState: "running",
			nativeSessionId: id.nativeSessionId,
		});
		expect(broker.state(id).leaseEpoch).toBeGreaterThan(control.leaseEpoch);
		broker.notification(id.workspaceId, id.profileHash, {
			method: "turn/completed",
			params: { threadId: id.nativeSessionId, turn: { id: "turn" } },
		});
		expect(broker.state(id).turnState).toBe("idle");
	});

	test("adapter paths cannot write while an ownership transition is pending", async () => {
		const { broker, id } = registered();
		const control = await broker.claim(
			id,
			broker.state(id).leaseEpoch,
			async () => false,
		);
		let finish: (id: string) => void = () => {};
		const opening = broker.open(
			id,
			control.leaseEpoch,
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		expect(() =>
			broker.guardAdapterWrite(
				id.workspaceId,
				id.profileHash,
				"turn/start",
				id.nativeSessionId,
			),
		).toThrow("owned by CLI");
		finish("terminal");
		await opening;
	});

	test("approval replies are single-use and resolved events release awaiting state", async () => {
		const { broker, id } = registered();
		const replies: unknown[] = [];
		const daemon = {
			client: { respond: (...args: unknown[]) => replies.push(args) },
		} as unknown as SharedCodexDaemon;
		broker.register(id, "/tmp/workspace", daemon);
		const control = await broker.claim(
			id,
			broker.state(id).leaseEpoch,
			async () => false,
		);
		broker.notification(id.workspaceId, id.profileHash, {
			method: "turn/started",
			params: { threadId: id.nativeSessionId, turn: { id: "turn" } },
		});
		broker.notification(id.workspaceId, id.profileHash, {
			method: "turn/completed",
			params: { threadId: id.nativeSessionId, turn: { id: "turn" } },
		});
		const claimed = await broker.claim(
			id,
			broker.state(id).leaseEpoch,
			async () => false,
		);
		(
			broker as unknown as {
				request(workspace: string, profile: string, event: unknown): void;
			}
		).request(id.workspaceId, id.profileHash, {
			id: 7,
			method: "item/commandExecution/requestApproval",
			params: {
				threadId: id.nativeSessionId,
				command: "bun test",
				cwd: "/tmp/workspace",
				reason: "Run project tests",
			},
		});
		expect(broker.state(id).pendingApprovals[0]?.detail).toMatchObject({
			command: "bun test",
			cwd: "/tmp/workspace",
			reason: "Run project tests",
		});
		expect(broker.state(id)).not.toHaveProperty("approvalItems");
		await broker.control(id, claimed.leaseEpoch, {
			type: "approve",
			requestId: "7",
			decision: "accept",
		});
		await expect(
			broker.control(id, claimed.leaseEpoch, {
				type: "approve",
				requestId: "7",
				decision: "accept",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		broker.notification(id.workspaceId, id.profileHash, {
			method: "serverRequest/resolved",
			params: { threadId: id.nativeSessionId, requestId: 7 },
		});
		expect(broker.state(id).turnState).toBe("idle");
		expect(replies).toHaveLength(1);
		expect(control.nativeSessionId).toBe(id.nativeSessionId);
	});
});
