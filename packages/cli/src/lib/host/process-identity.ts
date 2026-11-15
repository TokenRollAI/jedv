import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const HOST_PROCESS_NAME = "jedv-host";
const PS_TIMEOUT_MS = 2_000;

/**
 * Full command line for a live pid, or null when it can't be determined
 * (no `ps` on Windows, the pid is already gone, or `ps` errors). Callers
 * must treat null as "unknown" — never as a match or a mismatch.
 */
export async function inspectProcessCommand(
	pid: number,
): Promise<string | null> {
	if (process.platform === "win32") return null;
	return new Promise((resolve) => {
		execFile(
			"ps",
			["-p", String(pid), "-o", "command="],
			{ encoding: "utf8", timeout: PS_TIMEOUT_MS },
			(error, stdout) => resolve(error ? null : stdout.trim() || null),
		);
	});
}

export function looksLikeHostProcess(
	command: string,
	hostBinary = process.env.JEDV_HOST_BIN ??
		join(dirname(process.execPath), HOST_PROCESS_NAME),
): boolean {
	if (/^(?:\S*\/)?jedv-host(?:\s|$)/.test(command)) return true;

	// The standalone wrapper execs its sibling Node runtime. Match this install's
	// fixed paths: ps flattens argv, so guessing arbitrary paths with spaces could
	// mistake a Node script's arguments for the host executable.
	const binDir = dirname(resolve(hostBinary));
	return [join(binDir, "../lib"), `${binDir}/../lib`].some((libDir) => {
		const hostCommand = `${libDir}/node ${libDir}/host-service.js`;
		return command === hostCommand || command.startsWith(`${hostCommand} `);
	});
}
