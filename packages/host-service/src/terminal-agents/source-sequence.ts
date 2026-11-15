import {
	closeSync,
	constants,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
	rmdirSync,
} from "node:fs";
import { join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup";

/** One bounded, non-waiting sample under the producer's allocation lock.
 * null means authority cannot be re-established from this observation. */
export function readSourceSequenceWatermark(
	terminalId: string,
	launchId?: string,
): number | null {
	if (
		!launchId ||
		!/^[a-zA-Z0-9._-]+$/.test(terminalId) ||
		!/^[a-zA-Z0-9._-]+$/.test(launchId)
	)
		return null;
	const path = join(
			resolveAppHomeDir(),
			"state/hook-sequences",
			`${terminalId}.${launchId}`,
		),
		lock = `${path}.lock`;
	let owned = false,
		fd: number | undefined,
		result: number | null = null;
	try {
		// Never wait on an allocator in the Host input/event loop.
		mkdirSync(lock, { mode: 0o700 });
		owned = true;
		fd = openSync(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		const info = fstatSync(fd);
		if (!info.isFile() || info.size > 32) return null;
		const buffer = Buffer.alloc(32),
			length = readSync(fd, buffer, 0, buffer.length, 0),
			value = buffer.subarray(0, length).toString("utf8");
		if (/^\d+\n?$/.test(value) && Number.isSafeInteger(Number(value)))
			result = Number(value);
	} catch {
		result = null;
	} finally {
		if (fd !== undefined)
			try {
				closeSync(fd);
			} catch {
				result = null;
			}
		if (owned)
			try {
				rmdirSync(lock);
			} catch {
				result = null;
			}
	}
	return result;
}

/** Compatibility for callers that only need a numeric boot watermark. */
export function sourceSequenceAtRestore(
	terminalId: string,
	launchId?: string,
): number {
	return readSourceSequenceWatermark(terminalId, launchId) ?? 0;
}
