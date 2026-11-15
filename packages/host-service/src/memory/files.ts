import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function projectMemoryPath(
	root: string,
	requested?: string,
	create = false,
) {
	const canonicalRoot = realpathSync(root);
	const target = requested
		? isAbsolute(requested)
			? resolve(requested)
			: resolve(canonicalRoot, requested)
		: join(canonicalRoot, ".jedv", "memory.json");
	const rel = relative(canonicalRoot, target);
	if (
		!rel ||
		rel === ".." ||
		rel.startsWith(`..${sep}`) ||
		isAbsolute(rel) ||
		!target.endsWith(".json")
	)
		throw new Error("Memory file must be a JSON file inside the project");
	let current = canonicalRoot;
	for (const segment of rel.split(sep).slice(0, -1)) {
		current = join(current, segment);
		try {
			if (
				!lstatSync(current).isDirectory() ||
				lstatSync(current).isSymbolicLink()
			)
				throw new Error("Unsafe memory directory");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create)
				throw error;
			mkdirSync(current, { mode: 0o700 });
		}
	}
	try {
		const stat = lstatSync(target);
		if (stat.isSymbolicLink() || !stat.isFile())
			throw new Error("Unsafe memory file");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return target;
}
export function readProjectMemory(root: string, requested: string) {
	const file = projectMemoryPath(root, requested);
	const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (fstatSync(fd).size > 5_000_000)
			throw new Error("Memory import exceeds 5 MB");
		return JSON.parse(readFileSync(fd, "utf8"));
	} finally {
		closeSync(fd);
	}
}
export function writeProjectMemory(
	root: string,
	value: unknown,
	requested?: string,
) {
	const file = projectMemoryPath(root, requested, true);
	const temporary = join(dirname(file), `.memory-${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		renameSync(temporary, file);
	} finally {
		try {
			unlinkSync(temporary);
		} catch {
			// Cleanup must not hide an earlier write or rename error.
		}
	}
	return file;
}
