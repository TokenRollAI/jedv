import {
	type AgentLaunchConfig,
	getAgentCommandText,
} from "./agent-launch-command";

type Config = AgentLaunchConfig & { id: string; label?: string };
type Preset = { id: string; agentId?: string; commands: string[] };

export type PresetAgentLink<T extends Config> =
	| { status: "unlinked" }
	| { status: "linked"; agent: T }
	| { status: "missing" | "ambiguous" | "remote" };

export function resolvePresetAgentLink<T extends Config>(
	preset: { agentId?: string },
	agents: readonly T[],
	options: { remote: boolean },
): PresetAgentLink<T> {
	if (preset.agentId === undefined) return { status: "unlinked" };
	if (options.remote) return { status: "remote" };
	if (typeof preset.agentId !== "string" || !preset.agentId.trim())
		return { status: "missing" };
	const id = preset.agentId.trim();
	const exact = agents.filter((agent) => agent.id === id);
	if (exact.length === 1 && exact[0])
		return { status: "linked", agent: exact[0] };
	if (exact.length > 1) return { status: "ambiguous" };
	if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id))
		return { status: "missing" };
	const legacy = agents.filter((agent) => agent.presetId === id);
	if (legacy.length === 1 && legacy[0])
		return { status: "linked", agent: legacy[0] };
	return { status: legacy.length > 1 ? "ambiguous" : "missing" };
}

export function syncLinkedPresetSnapshots<T extends Config>(
	presets: readonly Preset[],
	updated: T,
	agents: readonly T[],
	options: { remote: boolean },
): Array<{ id: string; patch: { agentId: string; commands: string[] } }> {
	if (options.remote) return [];
	const current = agents.map((agent) =>
		agent.id === updated.id ? updated : agent,
	);
	if (!current.some((agent) => agent.id === updated.id)) current.push(updated);
	const command = getAgentCommandText(updated);
	if (!command.trim()) return [];
	return presets.flatMap((preset) => {
		const link = resolvePresetAgentLink(preset, current, { remote: false });
		if (link.status !== "linked" || link.agent.id !== updated.id) return [];
		if (
			preset.agentId === updated.id &&
			preset.commands.length === 1 &&
			preset.commands[0] === command
		)
			return [];
		return [
			{ id: preset.id, patch: { agentId: updated.id, commands: [command] } },
		];
	});
}
