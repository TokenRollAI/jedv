import type { ActiveBinding } from "../../components/ActiveWorkspaceSwitcher/active-workspaces";
import type { TerminalSession } from "../../types";

export function createAgentTabDiscovery(workspaceId: string) {
	let initialized = false;
	let overflow = false;
	const known = new Set<string>();
	const pending = new Set<string>();
	const nativeOwners = new Map<string, string>();
	const nativeIdentity = (binding: ActiveBinding) =>
		binding.agentSessionId
			? JSON.stringify([
					binding.agentId,
					binding.definitionId ?? null,
					binding.agentSessionId,
				])
			: null;
	const rememberNative = (binding: ActiveBinding) => {
		const identity = nativeIdentity(binding);
		if (!identity || nativeOwners.has(identity)) return;
		if (nativeOwners.size >= 512) {
			overflow = true;
			pending.clear();
			return;
		}
		nativeOwners.set(identity, binding.terminalId);
	};
	const remember = (id: string) => {
		if (!known.has(id) && known.size >= 512) {
			overflow = true;
			pending.clear();
			return;
		}
		known.add(id);
	};
	return (input: {
		ready: boolean;
		sessions: TerminalSession[];
		bindings: ActiveBinding[];
	}): TerminalSession[] => {
		if (!input.ready || overflow) return [];
		const sessions = input.sessions.filter(
			(row) => row.workspaceId === workspaceId,
		);
		const bindings = input.bindings.filter(
			(row) => row.workspaceId === workspaceId,
		);
		if (!initialized) {
			for (const row of sessions) remember(row.terminalId);
			for (const row of bindings) {
				remember(row.terminalId);
				rememberNative(row);
			}
			initialized = true;
			return [];
		}
		for (const row of sessions) {
			if (known.has(row.terminalId)) continue;
			remember(row.terminalId);
			if (!overflow) pending.add(row.terminalId);
		}
		if (overflow) return [];
		// Preserve native identities across disappearance and terminal replacement.
		// Existing terminals win even if the successor's binding arrived first.
		for (const row of bindings) {
			if (known.has(row.terminalId) && !pending.has(row.terminalId))
				rememberNative(row);
		}
		for (const row of bindings) rememberNative(row);
		if (overflow) return [];
		const liveAgents = new Map(
			bindings
				.filter((row) => row.endedAt == null)
				.map((row) => [row.terminalId, row]),
		);
		return sessions.filter((row) => {
			if (!pending.has(row.terminalId) || !liveAgents.has(row.terminalId))
				return false;
			pending.delete(row.terminalId);
			const agent = liveAgents.get(row.terminalId);
			const identity = agent ? nativeIdentity(agent) : null;
			return (
				!row.exited &&
				(!identity || nativeOwners.get(identity) === row.terminalId)
			);
		});
	};
}
