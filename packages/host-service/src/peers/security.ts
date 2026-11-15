import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	openSync,
	readFileSync,
} from "node:fs";
import { chmod, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TRPCError } from "@trpc/server";
export const token = () => randomBytes(32).toString("base64url");
export const hashToken = (raw: string) =>
	createHash("sha256").update(raw).digest("hex");
export function sameSecret(a: string, b: string): boolean {
	const x = Buffer.from(a),
		y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}
function canonical(x: unknown): unknown {
	if (Array.isArray(x)) return x.map(canonical);
	if (x && typeof x === "object")
		return Object.fromEntries(
			Object.entries(x)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, canonical(v)]),
		);
	return x;
}
export const payloadHash = (value: unknown) =>
	hashToken(JSON.stringify(canonical(value)));
export function problem(
	code:
		| "UNAUTHORIZED"
		| "FORBIDDEN"
		| "CONFLICT"
		| "PRECONDITION_FAILED"
		| "NOT_FOUND"
		| "TOO_MANY_REQUESTS"
		| "BAD_REQUEST",
	message: string,
): never {
	throw new TRPCError({ code, message });
}
export function readPrivateJson(path: string): unknown {
	let fd: number | undefined;
	try {
		fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = fstatSync(fd);
		if (!info.isFile() || info.size > 1_048_576)
			throw new Error("Invalid private configuration file");
		return JSON.parse(readFileSync(fd, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error("Cannot read private configuration");
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
export async function writePrivateJson(
	path: string,
	value: unknown,
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const info = await lstat(dir);
	if (info.isSymbolicLink() || !info.isDirectory())
		throw new Error("Unsafe private configuration directory");
	await chmod(dir, 0o700);
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
		await rename(temp, path);
		await chmod(path, 0o600);
	} finally {
		await rm(temp, { force: true });
	}
}
