import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import { z } from "zod";

export const terminalPresetAgentInput = z.string().uuid().nullable().optional();

export function applyTerminalPresetAgent(
	preset: TerminalPreset,
	agentId: string | null | undefined,
): TerminalPreset {
	if (agentId === undefined) return preset;
	if (agentId === null) {
		const { agentId: _, ...unlinked } = preset;
		return unlinked;
	}
	return { ...preset, agentId };
}
