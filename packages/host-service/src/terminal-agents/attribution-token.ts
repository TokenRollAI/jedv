import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup";

let cached: { path: string; secret: Buffer } | undefined;

function secret(): Buffer {
	const dir = join(resolveAppHomeDir(), "state");
	const path = join(dir, "hook-attribution.key");
	if (cached?.path === path) return cached.secret;
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const value = readFileSync(path);
	if (value.length !== 32) throw new Error("Invalid hook attribution key");
	cached = { path, secret: value };
	return value;
}

export function issueAttributionToken(terminalId: string): string {
	return createHmac("sha256", secret()).update(terminalId).digest("hex");
}

export function verifyAttributionToken(
	terminalId: string,
	token: string | undefined,
): boolean {
	if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
	return timingSafeEqual(
		Buffer.from(token, "hex"),
		Buffer.from(issueAttributionToken(terminalId), "hex"),
	);
}
