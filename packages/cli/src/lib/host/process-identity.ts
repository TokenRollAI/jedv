import { execFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { readProcessExecutable } from "@jedv/agent-setup";

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

/** Unlike `command`, this field is not a flattened executable + argv string. */
export async function inspectProcessExecutable(
	pid: number,
): Promise<string | null> {
	return readProcessExecutable(pid);
}

export function looksLikeHostProcess(
	command: string,
	hostBinary = process.env.JEDV_HOST_BIN ??
		join(dirname(process.execPath), HOST_PROCESS_NAME),
	executable?: string | null,
): boolean {
	// A readable argv is not executable identity: argv[0] can be forged.
	if (!executable) return false;
	if (
		executable &&
		basename(executable) === HOST_PROCESS_NAME &&
		(command === executable || command.startsWith(`${executable} `))
	)
		return true;
	if (executable && looksLikeDesktopHostProcess(command, executable))
		return true;

	// The standalone wrapper execs its sibling Node runtime. Match this install's
	// fixed paths: ps flattens argv, so guessing arbitrary paths with spaces could
	// mistake a Node script's arguments for the host executable.
	const binDir = dirname(resolve(hostBinary));
	return [join(binDir, "../lib"), `${binDir}/../lib`].some((libDir) => {
		const hostCommand = `${libDir}/node ${libDir}/host-service.js`;
		return (
			resolve(executable) === resolve(libDir, "node") &&
			(command === hostCommand || command.startsWith(`${hostCommand} `))
		);
	});
}

function looksLikeDesktopHostProcess(
	command: string,
	executable: string,
): boolean {
	// Desktop launches exactly [Electron executable, sibling host-service bundle].
	// Require the whole pair, including its shared installation/worktree root;
	// an arbitrary script or an argument mentioning host-service is not ownership.
	const packaged = executable.match(/^(\/.*\.app)\/Contents\/MacOS\/Jedv$/);
	if (packaged) {
		const app = packaged[1];
		return (
			command ===
			`${app}/Contents/MacOS/Jedv ${app}/Contents/Resources/app.asar/dist/main/host-service.js`
		);
	}
	const development = executable.match(
		/^(\/.*?)(?:\/apps\/desktop)?\/node_modules\/(?:\.bun\/electron@[^/ ]+\/node_modules\/)?electron\/dist\/(Electron\.app\/Contents\/MacOS\/Electron|electron)$/,
	);
	if (!development) return false;
	return (
		command ===
		`${executable} ${development[1]}/apps/desktop/dist/main/host-service.js`
	);
}
