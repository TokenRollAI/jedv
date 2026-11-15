import { randomUUID } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { type AutomationFile, automationFileSchema } from "./schema";

export class AutomationStore {
	private value: AutomationFile;
	constructor(private readonly path: string) {
		try {
			this.value = automationFileSchema.parse(
				JSON.parse(readFileSync(path, "utf8")),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				this.value = { version: 1, definitions: [], runs: [] };
			else
				throw new Error(
					`Cannot load local automations at ${path}; the file was not changed`,
					{ cause: error },
				);
		}
	}
	read(): AutomationFile {
		return structuredClone(this.value);
	}
	write(value: AutomationFile): void {
		const validated = automationFileSchema.parse(value);
		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		let fd: number | undefined;
		try {
			fd = openSync(temporary, "wx", 0o600);
			writeFileSync(fd, `${JSON.stringify(validated, null, 2)}\n`);
			fsyncSync(fd);
			closeSync(fd);
			fd = undefined;
			renameSync(temporary, this.path);
			const directoryFd = openSync(dirname(this.path), "r");
			try {
				fsyncSync(directoryFd);
			} finally {
				closeSync(directoryFd);
			}
			this.value = validated;
		} catch (error) {
			throw new Error(`Cannot persist local automations at ${this.path}`, {
				cause: error,
			});
		} finally {
			if (fd !== undefined) closeSync(fd);
			try {
				unlinkSync(temporary);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					console.error("[automations] temporary file cleanup failed", error);
			}
		}
	}
}
