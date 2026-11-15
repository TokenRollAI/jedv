import { expect, test } from "bun:test";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeerSecretStore } from "./secret-store";
import { readPrivateJson, writePrivateJson } from "./security";

test("private writes complete with restrictive permissions, preserve existing evidence on error, and reject symlink directories", async () => {
	const root = await mkdtemp(join(tmpdir(), "jedv-private-io-")),
		path = join(root, "secrets/private.json");
	try {
		await writePrivateJson(path, { fixture: "first" });
		expect(readPrivateJson(path)).toEqual({ fixture: "first" });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await stat(join(root, "secrets"))).mode & 0o777).toBe(0o700);
		await expect(writePrivateJson(path, { bad: 1n })).rejects.toThrow();
		expect(await readFile(path, "utf8")).toBe('{"fixture":"first"}');
		expect(await readdir(join(root, "secrets"))).toEqual(["private.json"]);
		await symlink(join(root, "secrets"), join(root, "linked"), "dir");
		await expect(
			writePrivateJson(join(root, "linked/other.json"), { fixture: "refused" }),
		).rejects.toThrow("Unsafe private configuration directory");
		expect(await readdir(join(root, "secrets"))).toEqual(["private.json"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("serialized secret writes preserve concurrent entries and report rejected configuration without stranding later work", async () => {
	const root = await mkdtemp(join(tmpdir(), "jedv-secret-queue-"));
	const store = new PeerSecretStore(root),
		a = `fixture-a-${"a".repeat(32)}`,
		b = `fixture-b-${"b".repeat(32)}`;
	try {
		await Promise.all([store.set("a", a), store.set("b", b)]);
		expect(store.get("a")).toBe(a);
		expect(store.get("b")).toBe(b);
		await expect(store.set("invalid", "short")).rejects.toThrow();
		await store.set("a", null);
		expect(store.get("a")).toBeNull();
		expect(store.get("b")).toBe(b);
		expect(await readdir(join(root, "secrets"))).toEqual(["peer-tokens.json"]);
		const path = join(root, "secrets/peer-tokens.json");
		await writeFile(path, "{broken");
		await expect(store.set("b", b)).rejects.toThrow();
		expect(await readFile(path, "utf8")).toBe("{broken");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
