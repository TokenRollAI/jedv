import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
	HarnessFactory,
	HarnessFactoryOptions,
	ResolveAttachment,
} from "@jedv/chat-runtime";
import { createAcpAdapter } from "@jedv/chat-runtime";
import type { HostDb } from "../db";
import { resolveHostAgentConfig } from "../terminal-agents/agent-config";
import { chatLaunchPresetId } from "../trpc/router/agents/agents";
import { seedDefaultsIfEmpty } from "../trpc/router/settings/agent-configs";
import { captureSessionAccount } from "../trpc/router/usage/session-account/session-account";
import { ACP_HARNESSES } from "./acpCatalogue";
import {
	NativeCliOnlyError,
	nativeCommandSpec,
	nativeControlArgs,
	resolveConfiguredAgentCli,
} from "./agentCli";
import { buildChatAgentEnv } from "./agentEnv";
import { storeAgentImage } from "./agentImages";
import { agentLoginCommand } from "./agentLogin";
import type { ChatAgentBridge } from "./chatAgentBridge";

function resolveAdapterEntry(packageName: string): string {
	const moduleRequire = createRequire(import.meta.url);
	const pkgJson = moduleRequire.resolve(`${packageName}/package.json`);
	return join(dirname(pkgJson), "dist/index.js");
}

function configuredAcpLaunch(
	harness: string,
	db: HostDb,
	options: HarnessFactoryOptions,
) {
	const entry = ACP_HARNESSES[harness];
	if (!entry) throw new NativeCliOnlyError("This ACP harness is unavailable");
	seedDefaultsIfEmpty(db);
	const config = resolveHostAgentConfig(
		db,
		options.agentConfigId ?? entry.binary,
	);
	if (!config || chatLaunchPresetId(config) !== entry.binary)
		throw new NativeCliOnlyError(
			"The selected agent config does not match this ACP provider",
		);
	const command = nativeCommandSpec(config);
	const serviceArgs = nativeControlArgs(entry.binary, command.args);
	if (entry.adapter && serviceArgs.length)
		throw new NativeCliOnlyError(
			"This ACP translator has no configured service-argv forwarding contract. Use CLI-only launch instead of dropping these arguments.",
		);
	const fullAccess =
		entry.binary === "claude"
			? command.args.includes("--dangerously-skip-permissions")
			: command.args.includes("--dangerously-bypass-approvals-and-sandbox");
	return {
		entry,
		config,
		serviceArgs,
		defaultModeId: fullAccess ? entry.fullAccessModeId : undefined,
	};
}

async function resolvedAcpLaunch(
	launch: ReturnType<typeof configuredAcpLaunch>,
	options: HarnessFactoryOptions,
	env: () => Promise<NodeJS.ProcessEnv>,
	adapterEntry?: string,
) {
	const { entry, config, serviceArgs } = launch;
	const cli = await resolveConfiguredAgentCli({
		provider: entry.binary,
		config,
		cwd: options.cwd,
		minVersion: entry.minVersion,
		upgrade: entry.upgrade,
		env,
	});
	const loginCommand = agentLoginCommand(entry.binary, cli.env);
	const login = loginCommand ? { loginCommand } : {};
	if (!entry.adapter)
		return {
			command: cli.command,
			args: [...serviceArgs, ...entry.args],
			env: cli.env,
			...login,
		};
	if (!adapterEntry || !entry.executableEnv)
		throw new NativeCliOnlyError(
			"The ACP translator cannot receive the configured executable",
		);
	return {
		command: process.execPath,
		args: [adapterEntry, ...entry.args],
		env: {
			...cli.env,
			ELECTRON_RUN_AS_NODE: "1",
			[entry.executableEnv]: cli.command,
		},
		...login,
	};
}

export async function resolveAcpLaunchSpec(
	harness: string,
	db: HostDb,
	options: HarnessFactoryOptions,
	adapterEntry?: string,
	envOverride?: () => Promise<NodeJS.ProcessEnv>,
) {
	const launch = configuredAcpLaunch(harness, db, options);
	const spec = await resolvedAcpLaunch(
		launch,
		options,
		envOverride ??
			(() =>
				buildChatAgentEnv({
					db,
					cwd: options.cwd,
					workspaceId: options.scopeId,
					terminalId: options.terminalId,
					agentConfigId: launch.config.id,
					presetId: launch.entry.binary,
				})),
		adapterEntry,
	);
	return { ...spec, defaultModeId: launch.defaultModeId };
}

export function acpHarnessFactory(
	harness: string,
	db: HostDb,
	resolveAttachment: ResolveAttachment,
	agents?: ChatAgentBridge,
): HarnessFactory | null {
	const entry = ACP_HARNESSES[harness];
	if (!entry) return null;

	let adapterEntry: string | undefined;
	if (entry.adapter) {
		try {
			adapterEntry = resolveAdapterEntry(entry.adapter);
		} catch {
			return null;
		}
	}

	return (options) => {
		const launch = configuredAcpLaunch(harness, db, options);
		return createAcpAdapter({
			command: entry.binary,
			cwd: options.cwd,
			resolveAttachment,
			storeImage: storeAgentImage,
			...(launch.defaultModeId ? { defaultModeId: launch.defaultModeId } : {}),
			...(entry.clientApprovalModes ? { clientApprovalModes: true } : {}),
			...(entry.forkAtMessage ? { forkAtMessage: true } : {}),
			onSpawn: (pid) => agents?.spawned(options.sessionId, pid),
			launch: async () => {
				const spec = await resolvedAcpLaunch(
					launch,
					options,
					() =>
						buildChatAgentEnv({
							db,
							cwd: options.cwd,
							workspaceId: options.scopeId,
							terminalId: options.terminalId,
							agentConfigId: launch.config.id,
							presetId: entry.binary,
						}),
					adapterEntry,
				);
				const env = spec.env;
				void captureSessionAccount(
					entry.binary,
					(entry.binary === "codex" ? env.CODEX_HOME : env.CLAUDE_CONFIG_DIR) ??
						"",
					Boolean(
						entry.binary === "codex"
							? env.OPENAI_API_KEY
							: env.ANTHROPIC_API_KEY,
					),
				)
					.then((account) => {
						if (account) agents?.accountCaptured(options.sessionId, account);
					})
					.catch(() => undefined);
				return spec;
			},
		});
	};
}

export function acpHarnessEntries(
	db: HostDb,
	resolveAttachment: ResolveAttachment,
	agents?: ChatAgentBridge,
): [string, HarnessFactory][] {
	const entries: [string, HarnessFactory][] = [];
	for (const harness of Object.keys(ACP_HARNESSES)) {
		const factory = acpHarnessFactory(harness, db, resolveAttachment, agents);
		if (factory) entries.push([harness, factory]);
	}
	return entries;
}
