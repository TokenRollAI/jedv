import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Query libproc through macOS's system JXA bridge; no AppleEvents, compiler or
// optional addon is required. ps comm is argv[0], not executable identity.
const DARWIN_EXECUTABLE_SCRIPT = `
ObjC.import('Foundation');
ObjC.bindFunction('proc_pidpath', ['int', ['int', 'void *', 'uint32_t']]);
function run(argv) {
  const pid = Number(argv[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) return '';
  const buffer = $.NSMutableData.dataWithLength(4096);
  const length = $.proc_pidpath(pid, buffer.mutableBytes, 4096);
  if (length <= 0 || length >= 4096) return '';
  buffer.length = length;
  return JSON.stringify(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(buffer, $.NSUTF8StringEncoding)).replace(/\\u0000.*$/, ''));
}`;

export function parseProcessExecutableOutput(output: string): string | null {
	try {
		const path: unknown = JSON.parse(output);
		return typeof path === "string" &&
			isAbsolute(path) &&
			!/[\0\r\n]/.test(path)
			? path
			: null;
	} catch {
		return null;
	}
}

/** Kernel executable path, never an argv-derived substitute; unavailable is null. */
export async function readProcessExecutable(
	pid: number,
): Promise<string | null> {
	if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647)
		return null;
	try {
		let path: string;
		if (process.platform === "linux") {
			path = await readlink(`/proc/${pid}/exe`);
		} else if (process.platform === "darwin") {
			const result = await execute(
				"/usr/bin/osascript",
				["-l", "JavaScript", "-e", DARWIN_EXECUTABLE_SCRIPT, String(pid)],
				{ encoding: "utf8", timeout: 2_000, maxBuffer: 16 * 1024 },
			);
			return parseProcessExecutableOutput(result.stdout);
		} else {
			return null;
		}
		return isAbsolute(path) && !/[\0\r\n]/.test(path) ? path : null;
	} catch {
		// Inspection may race process exit or be denied. Never expose child output.
		return null;
	}
}
