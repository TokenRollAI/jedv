import {
	AGENT_SETUP_TARGETS,
	type AgentSetupTargetId,
} from "./agent-setup-targets";
import {
	createAgyHooksJson,
	createAgyWrapper,
	createClaudeSettingsJson,
	createClaudeWrapper,
	createCodexHooksJson,
	createCodexWrapper,
	createKimiConfigToml,
	createKimiWrapper,
	removeAgyManagedHooks,
	removeClaudeManagedHooks,
	removeCodexManagedHooks,
	removeKimiManagedHooks,
} from "./agent-wrappers";
import { createArtifactGuardScript } from "./artifact-guard-hook";
import { provisionBuiltinTeamSkill } from "./managed-skills";
import { createNotifyScript } from "./notify-hook";

type LabeledAction = readonly [label: string, action: () => void];

/** Shared prerequisites: per-agent hooks reference these scripts. */
const BOOTSTRAP_SETUP: readonly LabeledAction[] = [
	["notify-script", createNotifyScript],
	["artifact-guard-script", createArtifactGuardScript],
];

interface AgentSetupDefinition {
	/** Writers that (re)register the agent's Jedv integration. */
	setup: readonly (() => void)[];
	/**
	 * Removes Jedv's footprint from the agent's global config when the
	 * user disables its hook integration. Wrappers and scripts under
	 * ~/.jedv/ stay — they are Jedv-owned and inert outside its
	 * terminals. Absent when the agent has no global footprint (Copilot,
	 * OpenCode).
	 */
	teardown?: readonly (() => void)[];
}

const AGENT_SETUP_DEFINITIONS: Record<
	AgentSetupTargetId,
	AgentSetupDefinition
> = {
	claude: {
		setup: [createClaudeSettingsJson, createClaudeWrapper],
		teardown: [removeClaudeManagedHooks],
	},
	codex: {
		setup: [createCodexHooksJson, createCodexWrapper],
		teardown: [removeCodexManagedHooks],
	},
	agy: {
		setup: [createAgyHooksJson, createAgyWrapper],
		teardown: [removeAgyManagedHooks],
	},
	kimi: {
		setup: [createKimiConfigToml, createKimiWrapper],
		teardown: [removeKimiManagedHooks],
	},
};

/**
 * One bad $HOME state (permissions, a config another tool corrupted) must not
 * break app boot or block the remaining agents' setup — isolate every action.
 */
export function runSetupAction(label: string, action: () => void): boolean {
	try {
		action();
		return true;
	} catch (error) {
		console.warn(`[agent-setup] ${label} failed:`, error);
		return false;
	}
}

function runAgentActions(
	agentId: string,
	actions: readonly (() => void)[] | undefined,
	failed: string[],
): void {
	for (const action of actions ?? []) {
		const label = `${agentId}:${action.name || "action"}`;
		if (!runSetupAction(label, action)) failed.push(label);
	}
}

function warnOnFailures(failed: string[]): void {
	if (failed.length > 0) {
		console.warn(
			`[agent-setup] ${failed.length} setup action(s) failed: ${failed.join(", ")}`,
		);
	}
}

interface SetupAgentCapabilitiesOptions {
	/**
	 * Agents whose hook integration the user disabled. Their teardown actions
	 * run instead of setup, actively reaping entries written by older app
	 * versions or while the toggle changed offline.
	 */
	disabledAgentIds?: readonly string[];
	/** Skills the user disabled; withheld from provisioning and reaped. */
	disabledSkillIds?: readonly string[];
}

export function setupAgentCapabilities({
	disabledAgentIds = [],
	disabledSkillIds = [],
}: SetupAgentCapabilitiesOptions = {}): void {
	const disabled = new Set(disabledAgentIds);
	const failed: string[] = [];
	if (
		!runSetupAction("team-skill", () =>
			provisionBuiltinTeamSkill({
				disabled: disabledSkillIds.includes("jedv-team"),
			}),
		)
	)
		failed.push("team-skill");
	for (const [label, action] of BOOTSTRAP_SETUP) {
		if (!runSetupAction(label, action)) failed.push(label);
	}

	for (const target of AGENT_SETUP_TARGETS) {
		const definition = AGENT_SETUP_DEFINITIONS[target.id];
		runAgentActions(
			target.id,
			disabled.has(target.id) ? definition.teardown : definition.setup,
			failed,
		);
	}

	warnOnFailures(failed);
}

/**
 * Re-run setup for one agent. Bootstrap actions run first because per-agent
 * hooks reference the shared notify script — without them the per-agent setup
 * isn't self-sufficient. Returns `false` for unknown ids.
 */
export function setupSingleAgent(agentId: string): boolean {
	const definition = AGENT_SETUP_DEFINITIONS[agentId as AgentSetupTargetId];
	if (!definition) return false;
	const failed: string[] = [];
	if (!runSetupAction("team-skill", provisionBuiltinTeamSkill))
		failed.push("team-skill");
	for (const [label, action] of BOOTSTRAP_SETUP) {
		if (!runSetupAction(label, action)) failed.push(label);
	}

	runAgentActions(agentId, definition.setup, failed);
	warnOnFailures(failed);
	return true;
}

/**
 * Removes one agent's Jedv footprint from its global config. Returns
 * `false` for unknown ids; `true` even when the agent has no teardown
 * actions (no global footprint to remove).
 */
export function teardownSingleAgent(agentId: string): boolean {
	const definition = AGENT_SETUP_DEFINITIONS[agentId as AgentSetupTargetId];
	if (!definition) return false;
	const failed: string[] = [];
	runAgentActions(agentId, definition.teardown, failed);
	warnOnFailures(failed);
	return true;
}
