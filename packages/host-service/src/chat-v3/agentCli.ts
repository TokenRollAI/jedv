import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getBinDir } from "@jedv/agent-setup";
import { hasShellSyntax } from "@jedv/shared/agent-prompt-launch";
import { TRPCError } from "@trpc/server";
import { coerce, gte } from "semver";
import { UNGATED_VERSION } from "./acpCatalogue";

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

export type AgentCli = {
	command: string;
	env: NodeJS.ProcessEnv;
};

function isExecutableFile(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

const WIN32_DIRECT_EXEC_EXTENSIONS = [".exe", ".com"];

function candidateNames(binary: string): string[] {
	if (process.platform !== "win32") return [binary];
	return WIN32_DIRECT_EXEC_EXTENSIONS.map((ext) => binary + ext);
}

function findOnPath(binary: string, env: NodeJS.ProcessEnv): string | null {
	for (const dir of (env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const name of candidateNames(binary)) {
			if (isExecutableFile(join(dir, name))) return join(dir, name);
		}
	}
	return null;
}

function jedvWrapper(binary: string): string | null {
	if (process.platform === "win32") return null;
	const wrapper = join(getBinDir(), binary);
	return isExecutableFile(wrapper) ? wrapper : null;
}

export function agentCliCommand(
	binary: string,
	env: NodeJS.ProcessEnv,
	cwd?: string,
): string {
	if (isAbsolute(binary) || binary.includes("/") || binary.includes("\\"))
		return isAbsolute(binary) ? binary : resolve(cwd ?? process.cwd(), binary);
	return jedvWrapper(binary) ?? findOnPath(binary, env) ?? binary;
}

const cache = new Map<string, { at: number; version: string | null }>();

function parseVersion(output: string): string | null {
	return output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

async function probeVersion(
	command: string,
	env: NodeJS.ProcessEnv,
): Promise<string | null> {
	const hit = cache.get(command);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.version;
	let version: string | null = null;
	try {
		const { stdout, stderr } = await execFileAsync(command, ["--version"], {
			env,
			timeout: VERSION_TIMEOUT_MS,
		});
		version = parseVersion(stdout) ?? parseVersion(stderr);
	} catch {
		version = null;
	}
	cache.set(command, { at: Date.now(), version });
	return version;
}

export function clearAgentCliCache(): void {
	cache.clear();
}

export function agentCliUnsupported(options: {
	binary: string;
	minVersion: string;
	found: string | null;
	upgrade?: string;
}): string {
	const upgrade = options.upgrade ? ` Upgrade with: ${options.upgrade}` : "";
	const wanted =
		UNGATED_VERSION === options.minVersion
			? ""
			: ` ${options.minVersion} or newer`;
	if (!options.found) {
		return (
			`${options.binary} was not found, so this chat cannot start. Install` +
			` ${options.binary}${wanted} and make sure it is on your PATH.${upgrade}`
		);
	}
	return `${options.binary} ${options.minVersion} or newer is needed for chat, and ${options.found} is installed.${upgrade}`;
}

function meetsFloor(found: string, minVersion: string): boolean {
	if (minVersion === UNGATED_VERSION) return true;
	const coerced = coerce(found);
	return !coerced || gte(coerced, minVersion);
}

export async function resolveAgentCli(options: {
	binary: string;
	minVersion: string;
	upgrade?: string;
	env: () => Promise<NodeJS.ProcessEnv>;
	cwd?: string;
}): Promise<AgentCli> {
	const env = await options.env();
	const command = agentCliCommand(options.binary, env, options.cwd);
	const found = await probeVersion(command, env);
	if (!found || !meetsFloor(found, options.minVersion)) {
		throw new Error(agentCliUnsupported({ ...options, found }));
	}
	return { command, env };
}

export class NativeCliOnlyError extends TRPCError {
	constructor(message: string) {
		super({ code: "PRECONDITION_FAILED", message });
	}
}
export type NativeCliConfig = {
	command: string;
	args: string[];
	env: Record<string, string>;
	resumeArgs: string[];
};
export function nativeCommandSpec(config: NativeCliConfig) {
	let command = config.command;
	const args = [...config.args];
	const env = { ...config.env };
	if (args.length === 0 && hasShellSyntax(command))
		throw new NativeCliOnlyError(
			"Shell command syntax requires CLI-only launch; native adapters require an executable and argv",
		);
	if (basename(command) === "env") {
		while (args.length) {
			const token = args[0];
			if (!token) break;
			const equals = token.indexOf("=");
			if (
				equals <= 0 ||
				!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token.slice(0, equals))
			)
				break;
			env[token.slice(0, equals)] = token.slice(equals + 1);
			args.shift();
		}
		command = args.shift() ?? "";
		if (!command || command.startsWith("-") || basename(command) === "env")
			throw new NativeCliOnlyError(
				"Only env KEY=value executable argv is supported by native adapters; env flags and nested wrappers require CLI-only launch",
			);
	}
	if (
		!command ||
		[
			"mise",
			"npx",
			"bunx",
			"npm",
			"pnpm",
			"yarn",
			"node",
			"bun",
			"sh",
			"bash",
			"zsh",
			"fish",
			"cmd",
			"powershell",
		].includes(basename(command))
	)
		throw new NativeCliOnlyError(
			"This command wrapper requires CLI-only launch; native services cannot silently replace it with the default provider",
		);
	return { command, args, env, resumeArgs: [...config.resumeArgs] };
}
export function nativeControlArgs(provider: string, args: string[]): string[] {
	if (provider === "claude") {
		if (args.some((arg) => arg !== "--dangerously-skip-permissions"))
			throw new NativeCliOnlyError(
				"The Claude SDK launch supports executable/env and its permission mode; additional configured CLI arguments require CLI-only launch",
			);
		return [];
	}
	if (provider === "codex") {
		const server: string[] = [];
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (
				arg === "--dangerously-bypass-approvals-and-sandbox" ||
				arg === "--dangerously-bypass-hook-trust"
			)
				continue;
			if (
				arg &&
				["-c", "--config", "--enable", "--disable"].includes(arg) &&
				args[i + 1] !== undefined
			) {
				server.push(arg, args[++i] as string);
				continue;
			}
			if (
				arg &&
				["--config=", "--enable=", "--disable="].some((prefix) =>
					arg.startsWith(prefix),
				)
			) {
				server.push(arg);
				continue;
			}
			throw new NativeCliOnlyError(
				"Configured Codex arguments are not compatible with the shared app-server; use CLI-only launch instead of dropping arguments",
			);
		}
		return server;
	}
	if (
		args.some((arg) =>
			[
				"-p",
				"--prompt",
				"--print",
				"--resume",
				"--session",
				"--conversation",
				"--remote",
			].includes(arg),
		)
	)
		throw new NativeCliOnlyError(
			"Interactive prompt/resume arguments cannot be reused as ACP service arguments; use CLI-only launch",
		);
	return [...args];
}
export async function resolveConfiguredAgentCli(options: {
	provider: string;
	config: NativeCliConfig;
	cwd: string;
	minVersion: string;
	upgrade?: string;
	env: () => Promise<NodeJS.ProcessEnv>;
}) {
	const spec = nativeCommandSpec(options.config);
	const cli = await resolveAgentCli({
		binary: spec.command,
		cwd: options.cwd,
		minVersion: options.minVersion,
		upgrade: options.upgrade,
		env: async () => ({ ...(await options.env()), ...spec.env }),
	});
	const configurationKey = createHash("sha256")
		.update(
			JSON.stringify([
				cli.command,
				spec.args,
				Object.entries(spec.env).sort(([a], [b]) => a.localeCompare(b)),
			]),
		)
		.digest("hex");
	return {
		...cli,
		baseArgs: spec.args,
		resumeArgs: spec.resumeArgs,
		configurationKey,
	};
}
