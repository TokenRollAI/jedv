import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup";

export class DeepseekSecretStore {
	constructor(private readonly home: () => string = resolveAppHomeDir) {}
	private path() {
		const dir = join(this.home(), "secrets");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())
			throw new Error("Unsafe secret directory");
		chmodSync(dir, 0o700);
		return join(dir, "deepseek.key");
	}
	readKey(): string | null {
		let fd: number | undefined;
		try {
			fd = openSync(this.path(), constants.O_RDONLY | constants.O_NOFOLLOW);
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size > 512) return null;
			fchmodSync(fd, 0o600);
			const key = readFileSync(fd, "utf8").trim();
			return /^[!-~]{8,512}$/.test(key) ? key : null;
		} catch {
			return null;
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	}
	get() {
		const key = this.readKey();
		return {
			configured: !!key,
			maskedHint: key ? `••••${key.slice(-4)}` : null,
		};
	}
	setDeepseekKey(apiKey: string | null) {
		if (apiKey !== null && !/^[!-~]{8,512}$/.test(apiKey))
			throw new Error("Invalid DeepSeek key format");
		const file = this.path();
		if (apiKey === null) {
			try {
				unlinkSync(file);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					throw new Error("Cannot clear DeepSeek key");
			}
			return this.get();
		}
		const temp = `${file}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temp, apiKey, { mode: 0o600, flag: "wx" });
			renameSync(temp, file);
			chmodSync(file, 0o600);
		} catch {
			throw new Error("Cannot save DeepSeek key");
		} finally {
			try {
				unlinkSync(temp);
			} catch {
				/* Already renamed or never created. */
			}
		}
		return this.get();
	}
}
