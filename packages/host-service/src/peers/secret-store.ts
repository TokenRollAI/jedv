import { join } from "node:path";
import { narrowTokenSchema } from "@jedv/shared/teamwork-peers";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./security";

const schema = z.record(z.string(), narrowTokenSchema);
export class PeerSecretStore {
	private readonly path: string;
	private writes: Promise<void> = Promise.resolve();
	constructor(home: string) {
		this.path = join(home, "secrets/peer-tokens.json");
	}
	get(id: string): string | null {
		return schema.parse(readPrivateJson(this.path) ?? {})[id] ?? null;
	}
	set(id: string, value: string | null): Promise<void> {
		const next = this.writes.then(async () => {
			const all = schema.parse(readPrivateJson(this.path) ?? {});
			if (value === null) delete all[id];
			else all[id] = narrowTokenSchema.parse(value);
			await writePrivateJson(this.path, all);
		});
		this.writes = next.catch(() => {});
		return next;
	}
}
