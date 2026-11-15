import { delimiter } from "node:path";
import { getBinDir } from "@jedv/agent-setup";
import { eq } from "drizzle-orm";
import type { HostDb } from "../db";
import { workspaces } from "../db/schema";
import { getProjectIncludingDeleted } from "../projects/local-project-store";
import { buildHostLaunchEnv, waitForTerminalBaseEnv } from "../terminal/env";
import {
	agentLaunchEnv,
	resolveHostAgentConfig,
} from "../terminal-agents/agent-config";
import { chatLaunchPresetId } from "../trpc/router/agents/agents";
import { resolveDefaultAccountTerminalEnv } from "../trpc/router/usage/default-account";

function workspacePaths(
	db: HostDb,
	workspaceId: string,
): { workspacePath: string; rootPath: string } {
	const workspace = db.query.workspaces
		.findFirst({ where: eq(workspaces.id, workspaceId) })
		.sync();
	const project = workspace?.projectId
		? getProjectIncludingDeleted(db, workspace.projectId)
		: undefined;
	return {
		workspacePath: workspace?.worktreePath ?? "",
		rootPath: project?.repoPath ?? "",
	};
}

function withJedvBinFirst(env: Record<string, string>): Record<string, string> {
	const binDir = getBinDir();
	const key =
		Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
	const entries = (env[key] ?? "")
		.split(delimiter)
		.filter((entry) => entry && entry !== binDir);
	return { ...env, [key]: [binDir, ...entries].join(delimiter) };
}

/**
 * The launch env an agent config adds, account dir and keys included. A config
 * edited to run another CLI since the chat started adds nothing: its env
 * belongs to that CLI.
 */
function configEnv(
	db: HostDb,
	agentConfigId: string | undefined,
	presetId: string | undefined,
): Record<string, string> {
	const config = agentConfigId
		? resolveHostAgentConfig(db, agentConfigId)
		: null;
	if (!config || !presetId || chatLaunchPresetId(config) !== presetId)
		return {};
	return agentLaunchEnv(db, config);
}

function withoutReplacedKeys(
	env: Record<string, string>,
	overlay: Record<string, string>,
): Record<string, string> {
	if (!overlay.ANTHROPIC_API_KEY && !overlay.ANTHROPIC_AUTH_TOKEN) return env;
	const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = env;
	return rest;
}

/**
 * A chat agent is launched with the env a terminal would launch it with, so
 * the same CLI resolves the same tools and auth either way. the app bin directory
 * leads PATH because a terminal picks that up from the shell bootstrap, which
 * a directly spawned agent never runs, and it is what puts the jedv CLI
 * and the agent wrappers in reach. A chat opened with an agent config gets
 * that config's env on top, as its terminal would, so a "Claude (work)" chat
 * runs on the work account; a key set there is the user's own and stays.
 */
export async function buildChatAgentEnv(options: {
	db: HostDb;
	cwd: string;
	workspaceId: string;
	terminalId?: string;
	agentConfigId?: string;
	/** The CLI the chat runs (`claude`, `codex`, …); a config applies only to its own. */
	presetId?: string;
}): Promise<Record<string, string>> {
	await waitForTerminalBaseEnv();
	const paths = workspacePaths(options.db, options.workspaceId);
	const overlay = configEnv(
		options.db,
		options.agentConfigId,
		options.presetId,
	);
	return withJedvBinFirst({
		...withoutReplacedKeys(
			{
				...buildHostLaunchEnv({
					cwd: options.cwd,
					workspaceId: options.workspaceId,
					terminalId: options.terminalId,
					workspacePath: paths.workspacePath || options.cwd,
					rootPath: paths.rootPath,
				}),
				...resolveDefaultAccountTerminalEnv(options.db),
			},
			overlay,
		),
		...overlay,
	});
}
