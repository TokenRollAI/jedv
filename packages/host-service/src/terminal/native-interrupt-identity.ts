import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { readProcessExecutable } from "@jedv/agent-setup";
import type { TerminalAgentBinding } from "../terminal-agents/types";

const execute = promisify(execFile);
const keys = [
	"JEDV_TERMINAL_ID",
	"JEDV_WORKSPACE_ID",
	"JEDV_AGENT_LAUNCH_ID",
	"JEDV_AGENT_ID",
] as const;
type IdentityEnvironment = Partial<Record<(typeof keys)[number], string>>;

export interface NativeForegroundProcess {
	pid: number;
	ppid: number;
	pgid: number;
	foregroundPgid: number;
	tty: string | null;
	startedAt: string;
}
export interface NativeInterruptIdentityDependencies {
	processes(): Promise<NativeForegroundProcess[] | null>;
	executable(pid: number): Promise<string | null>;
	environment(pid: number): Promise<IdentityEnvironment | null>;
	canonicalize(path: string): Promise<string>;
}
export interface NativeInterruptForegroundProof {
	pid: number;
	executable: string;
	/** A process snapshot is not an input permit. Recheck beside the guarded write. */
	isCurrent(): Promise<boolean>;
}

async function ps(args: string[]) {
	try {
		return (
			await execute("ps", args, {
				encoding: "utf8",
				timeout: 2_000,
				maxBuffer: 8 * 1024 * 1024,
			})
		).stdout;
	} catch {
		// Errors can include argv or complete environments; never forward them.
		return null;
	}
}

export function parseNativeForegroundProcesses(
	output: string,
): NativeForegroundProcess[] {
	return output.split("\n").flatMap((line) => {
		const match = line
			.trim()
			.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.+)$/);
		if (!match) return [];
		const [pid, ppid, pgid, foregroundPgid] = match.slice(1, 5).map(Number);
		if (
			!pid ||
			ppid === undefined ||
			!pgid ||
			foregroundPgid === undefined ||
			!match[5] ||
			!match[6]
		)
			return [];
		return [
			{
				pid,
				ppid,
				pgid,
				foregroundPgid,
				tty: ["?", "??", "-"].includes(match[5]) ? null : match[5],
				startedAt: match[6],
			},
		];
	});
}

/** Picks only allowlisted identity fields; ambiguous duplicate values fail closed. */
export function parseNativeIdentityEnvironment(
	entries: string[],
): IdentityEnvironment | null {
	const result: IdentityEnvironment = {};
	for (const key of keys) {
		const matches = entries.filter((entry) => entry.startsWith(`${key}=`));
		if (matches.length > 1) return null;
		const value = matches[0]?.slice(key.length + 1);
		if (value !== undefined) result[key] = value;
	}
	return result;
}

const defaults: NativeInterruptIdentityDependencies = {
	processes: async () => {
		if (process.platform !== "darwin" && process.platform !== "linux")
			return null;
		const result = await ps(["-axo", "pid=,ppid=,pgid=,tpgid=,tty=,lstart="]);
		return result === null ? null : parseNativeForegroundProcesses(result);
	},
	executable: readProcessExecutable,
	environment: async (pid) => {
		if (process.platform === "linux") {
			const raw = await readFile(`/proc/${pid}/environ`, "utf8").catch(
				() => null,
			);
			return raw === null
				? null
				: parseNativeIdentityEnvironment(raw.split("\0"));
		}
		if (process.platform !== "darwin") return null;
		const command = (
			await ps(["-ww", "-p", String(pid), "-o", "command="])
		)?.trim();
		const withEnvironment = (
			await ps(["-Eww", "-p", String(pid), "-o", "command="])
		)?.trim();
		if (!command || !withEnvironment?.startsWith(`${command} `)) return null;
		return parseNativeIdentityEnvironment(
			withEnvironment.slice(command.length + 1).split(/\s+/),
		);
	},
	canonicalize: realpath,
};

/**
 * Read-only confirmation of the exact known provider binary in this PTY's
 * foreground group. The caller supplies a separately resolved/version-verified
 * native executable, not the Jedv shell wrapper or an arbitrary command string.
 */
export async function inspectNativeInterruptForeground(
	input: {
		shellPid: number;
		expectedAgent: TerminalAgentBinding;
		expectedExecutable: string;
	},
	deps: NativeInterruptIdentityDependencies = defaults,
): Promise<NativeInterruptForegroundProof | null> {
	const expected = input.expectedAgent;
	if (
		expected.agentId !== "codex" ||
		!expected.launchId ||
		!expected.agentSessionId ||
		!Number.isSafeInteger(input.shellPid) ||
		input.shellPid <= 1 ||
		!isAbsolute(input.expectedExecutable)
	)
		return null;
	try {
		const expectedExecutable = await deps.canonicalize(
			input.expectedExecutable,
		);
		const inspect = async () => {
			const table = await deps.processes();
			const shell = table?.find((row) => row.pid === input.shellPid);
			if (
				!table ||
				!shell?.tty ||
				shell.foregroundPgid <= 1 ||
				shell.foregroundPgid === shell.pgid
			)
				return null;
			const descendants = new Set([shell.pid]);
			for (let expanded = true; expanded; ) {
				expanded = false;
				for (const row of table)
					if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
						descendants.add(row.pid);
						expanded = true;
					}
			}
			const matches = [];
			for (const row of table) {
				if (
					row.pid === shell.pid ||
					!descendants.has(row.pid) ||
					row.pgid !== shell.foregroundPgid ||
					row.tty !== shell.tty
				)
					continue;
				const executable = await deps.executable(row.pid);
				if (
					executable &&
					(await deps.canonicalize(executable)) === expectedExecutable
				)
					matches.push(row);
			}
			if (matches.length !== 1) return null;
			const candidate = matches[0];
			if (!candidate) return null;
			const env = await deps.environment(candidate.pid);
			if (
				env?.JEDV_TERMINAL_ID !== expected.terminalId ||
				env.JEDV_WORKSPACE_ID !== expected.workspaceId ||
				env.JEDV_AGENT_LAUNCH_ID !== expected.launchId ||
				env.JEDV_AGENT_ID !== "codex"
			)
				return null;
			return { shell, candidate, executable: expectedExecutable };
		};
		const before = await inspect();
		if (!before) return null;
		const signature = JSON.stringify(before);
		if (JSON.stringify(await inspect()) !== signature) return null;
		return {
			pid: before.candidate.pid,
			executable: expectedExecutable,
			isCurrent: async () => {
				try {
					return JSON.stringify(await inspect()) === signature;
				} catch {
					return false;
				}
			},
		};
	} catch {
		return null;
	}
}
