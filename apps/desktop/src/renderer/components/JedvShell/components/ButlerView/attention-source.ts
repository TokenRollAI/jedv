import type { AttentionSourceTarget } from "@jedv/shared/butler-attention";
import type { JedvParityViewContext } from "../../parity-types";
export const hasAttentionLocation = (source: AttentionSourceTarget) =>
	Boolean(
		(source.terminalLive && source.workspaceId && source.terminalId) ||
			(source.fallback === "workspace" && source.workspaceId) ||
			(source.fallback === "team" && source.teamId) ||
			source.fallback === "automations" ||
			source.fallback === "memory",
	);
export async function openAttentionSource(
	source: AttentionSourceTarget,
	context: JedvParityViewContext,
	navigate: {
		team(id: string): Promise<void> | void;
		automations(source: AttentionSourceTarget): void;
		memory(source: AttentionSourceTarget): void;
	},
) {
	let workspaceChecked = false,
		workspaceActive = false;
	const checkWorkspace = async () => {
		if (!source.workspaceId) return false;
		if (!workspaceChecked) {
			const workspace = await context.client.workspace.get.query({
				id: source.workspaceId,
			});
			workspaceActive = !!workspace && workspace.archivedAt == null;
			workspaceChecked = true;
		}
		return workspaceActive;
	};
	if (
		source.terminalLive &&
		source.workspaceId &&
		source.terminalId &&
		(await checkWorkspace())
	) {
		const terminals = await context.client.terminal.list.query({
			workspaceId: source.workspaceId,
		});
		if (
			terminals.sessions.some(
				(terminal) =>
					terminal.terminalId === source.terminalId && !terminal.exited,
			)
		) {
			await context.onOpenWorkspace(source.workspaceId, source.terminalId);
			return { terminalEnded: false };
		}
		// A fresh list can confirm a terminal ended after the Attention snapshot; never launch its replacement.
		await context.onOpenWorkspace(source.workspaceId);
		return { terminalEnded: true };
	}
	if (
		source.fallback === "workspace" &&
		source.workspaceId &&
		(await checkWorkspace())
	) {
		await context.onOpenWorkspace(source.workspaceId);
		return { terminalEnded: !!source.terminalId };
	}
	if (source.fallback === "team" && source.teamId) {
		await navigate.team(source.teamId);
		return { terminalEnded: !!source.terminalId };
	}
	if (source.fallback === "automations") {
		navigate.automations(source);
		return { terminalEnded: !!source.terminalId };
	}
	if (source.fallback === "memory") {
		navigate.memory(source);
		return { terminalEnded: false };
	}
	// Only a confirmed unavailable workspace can fall back to its team, never a failed snapshot query.
	if (workspaceChecked && !workspaceActive && source.teamId) {
		await navigate.team(source.teamId);
		return { terminalEnded: !!source.terminalId };
	}
	throw new Error("Attention source is unavailable");
}
