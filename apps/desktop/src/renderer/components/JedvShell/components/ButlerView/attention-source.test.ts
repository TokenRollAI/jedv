import { expect, mock, test } from "bun:test";
import type { AttentionSourceTarget } from "@jedv/shared/butler-attention";
import type { JedvParityViewContext } from "../../parity-types";
import { openAttentionSource } from "./attention-source";

const source: AttentionSourceTarget = {
	kind: "team_member",
	teamId: "team",
	memberId: "member",
	projectId: "project",
	workspaceId: "workspace",
	terminalId: "terminal",
	terminalLive: true,
	fallback: "workspace",
	mailDeliveryId: null,
	automationId: null,
	automationRunId: null,
};
function fixture({ live = true, fail = false } = {}) {
	const create = mock(async () => {}),
		open = mock(async (..._args: unknown[]) => {}),
		team = mock(async (_id: string) => {}),
		automations = mock((_source: AttentionSourceTarget) => {}),
		memory = mock((_source: AttentionSourceTarget) => {});
	const list = mock(async () => ({
		sessions: live ? [{ terminalId: "terminal", exited: false }] : [],
	}));
	const workspace = mock(async () => {
		if (fail) throw new Error("snapshot unavailable");
		return { id: "workspace", archivedAt: null };
	});
	const context = {
		client: {
			workspace: { get: { query: workspace } },
			terminal: { list: { query: list }, createSession: { mutate: create } },
			agents: { run: { mutate: create } },
		},
		onOpenWorkspace: open,
	} as unknown as JedvParityViewContext;
	return {
		context,
		open,
		create,
		list,
		workspace,
		navigate: { team, automations, memory },
	};
}
test("a live source focuses its exact terminal after fresh reads and never creates a session", async () => {
	const f = fixture();
	expect(await openAttentionSource(source, f.context, f.navigate)).toEqual({
		terminalEnded: false,
	});
	expect(f.open).toHaveBeenCalledWith("workspace", "terminal");
	expect(f.create).not.toHaveBeenCalled();
});
test("an ended source uses only its declared workspace fallback, without attaching or recreating the stale terminal", async () => {
	const f = fixture();
	expect(
		await openAttentionSource(
			{ ...source, terminalLive: false },
			f.context,
			f.navigate,
		),
	).toEqual({ terminalEnded: true });
	expect(f.open).toHaveBeenCalledWith("workspace");
	expect(f.list).not.toHaveBeenCalled();
	expect(f.create).not.toHaveBeenCalled();
});
test("a terminal disappearing after the source snapshot falls back to its workspace without spawning", async () => {
	const f = fixture({ live: false });
	expect(await openAttentionSource(source, f.context, f.navigate)).toEqual({
		terminalEnded: true,
	});
	expect(f.open).toHaveBeenCalledWith("workspace");
	expect(f.create).not.toHaveBeenCalled();
});
test("a failed snapshot never becomes a recovery or an inferred navigation target", async () => {
	const f = fixture({ fail: true });
	await expect(
		openAttentionSource(source, f.context, f.navigate),
	).rejects.toThrow("snapshot unavailable");
	expect(f.open).not.toHaveBeenCalled();
	expect(f.navigate.team).not.toHaveBeenCalled();
	expect(f.create).not.toHaveBeenCalled();
});
test("automation and memory fallbacks pass only structured source metadata", async () => {
	const f = fixture();
	const automation = {
		...source,
		kind: "automation_run" as const,
		terminalLive: false,
		fallback: "automations" as const,
		automationId: "automation",
		automationRunId: "run",
	};
	await openAttentionSource(automation, f.context, f.navigate);
	expect(f.navigate.automations).toHaveBeenCalledWith(automation);
	const memory = {
		...source,
		kind: "memory" as const,
		terminalLive: false,
		fallback: "memory" as const,
	};
	await openAttentionSource(memory, f.context, f.navigate);
	expect(f.navigate.memory).toHaveBeenCalledWith(memory);
	expect(f.create).not.toHaveBeenCalled();
});
